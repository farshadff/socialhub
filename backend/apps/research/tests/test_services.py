from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from ..collectors.base import CollectorError, SignalDraft
from ..models import ResearchRun, TrendSignal, TrendTopic
from ..schemas import TopicDraft, TopicSynthesis
from ..services import runs, synthesis, topics
from ..services.platform import JobRun
from .helpers import FakeCtx, FakeResult, make_account, make_plan, make_signal, make_source


class StubCollector:
    max_signals = 20

    def __init__(self, result):
        self.result = result

    def collect(self, source, ctx):
        if isinstance(self.result, Exception):
            raise self.result
        return [SignalDraft(**d.__dict__) for d in self.result]


def draft(url, title="Title", published_days_ago=1, metrics=None):
    return SignalDraft(kind="rss", url=url, title=title, excerpt="<p>Body  text</p>",
                       author="Pub", metrics=metrics or {},
                       published_at=timezone.now() - timedelta(days=published_days_ago))


class RunServiceTests(TestCase):
    def setUp(self):
        self.account = make_account()
        self.good = make_source(self.account, value="https://good.example/feed", label="Good")
        self.bad = make_source(self.account, value="https://bad.example/feed", label="Bad")
        job = JobRun.objects.create(kind="research.run", target_type="research_run",
                                    target_id="0", status="running", account=self.account)
        self.run = ResearchRun.objects.create(
            account=self.account, job=job, status="running", started_at=timezone.now(),
            params={"lookback_days": 7, "source_ids": None, "collect": True,
                    "synthesize": False})

    def execute(self, mapping):
        def fake_collectors():
            return {"rss": _ByURL(mapping), "web_search": _ByURL(mapping)}

        ctx = FakeCtx()
        with mock.patch.object(runs, "collectors", fake_collectors):
            runs.execute_run(self.run.pk, ctx)
        self.run.refresh_from_db()
        return ctx

    def test_partial_failure_and_dedupe(self):
        ctx = self.execute({
            "https://good.example/feed": [draft("https://x.example/a/?utm_source=1"),
                                          draft("https://x.example/a"),
                                          draft("https://x.example/old", published_days_ago=20),
                                          draft("https://x.example/b", title="  ")],
            "https://bad.example/feed": CollectorError("timeout"),
        })
        self.assertEqual(ctx.outcome[0], "succeeded")
        self.assertEqual(self.run.status, "completed")
        stats = self.run.stats
        self.assertEqual(stats["signals"], 1)
        self.assertEqual(stats["duplicates"], 1)
        self.assertEqual(stats["by_source"][str(self.bad.pk)]["status"], "error:timeout")
        self.assertEqual(stats["synthesis"], "skipped")
        signal = TrendSignal.objects.get()
        self.assertEqual(signal.excerpt, "Body text")
        self.assertEqual(signal.source, self.good)
        self.good.refresh_from_db()
        self.assertEqual(self.good.last_status, "ok")
        self.assertTrue(ctx.progress_calls[0][1].startswith("Collecting Good (1 of 2)"))

    def test_second_run_finds_duplicates_and_updates_metrics(self):
        make_signal(self.account, url="https://x.example/a", metrics={"likes": 1})
        self.execute({"https://good.example/feed": [draft("https://x.example/a",
                                                          metrics={"likes": 50})],
                      "https://bad.example/feed": []})
        self.assertEqual(self.run.stats["signals"], 0)
        self.assertEqual(self.run.stats["duplicates"], 1)
        self.assertEqual(TrendSignal.objects.get().metrics, {"likes": 50})
        self.good.refresh_from_db()
        self.assertEqual(self.good.last_status, "empty")

    def test_all_sources_failed(self):
        ctx = self.execute({"https://good.example/feed": CollectorError("http_500"),
                            "https://bad.example/feed": CollectorError("invalid_feed")})
        self.assertEqual(ctx.outcome[:2], ("failed", "all_sources_failed"))
        self.assertEqual(self.run.status, "failed")

    def test_inactive_and_unavailable_sources(self):
        self.bad.active = False
        self.bad.save()
        web = make_source(self.account, kind="web_search", value="coffee trends", label="Web")
        with mock.patch("apps.research.services.platform.text_provider_configured",
                        return_value=False):
            self.execute({"https://good.example/feed": [draft("https://x.example/z")]})
        self.assertNotIn(str(self.bad.pk), self.run.stats["by_source"])
        self.assertEqual(self.run.stats["by_source"][str(web.pk)]["status"],
                         "error:provider_not_configured")
        order = list(self.run.stats["by_source"])
        self.assertEqual(order[0], str(web.pk))  # web search before RSS

    def test_redelivered_task_exits(self):
        self.run.status = "completed"
        self.run.save()
        ctx = self.execute({})
        self.assertIsNone(ctx.outcome)

    def test_stale_run_recovery(self):
        self.run.started_at = timezone.now() - timedelta(minutes=31)
        self.run.save()
        runs.recover_stale_runs(self.account)
        self.run.refresh_from_db()
        self.assertEqual(self.run.status, "failed")
        self.assertEqual(self.run.job.error_code, "stale_run")


class _ByURL:
    max_signals = 20

    def __init__(self, mapping):
        self.mapping = mapping

    def collect(self, source, ctx):
        return StubCollector(self.mapping.get(source.value, [])).collect(source, ctx)


def topic_draft(title, ids, hooks=None, formats=("reel",)):
    return TopicDraft(title=title, summary="s", why_now="w", hooks=hooks or ["h1", "h2"],
                      suggested_formats=list(formats), keywords=["a", "b", "c"], signal_ids=ids)


class SynthesisTests(TestCase):
    def setUp(self):
        self.account = make_account()
        self.account.brand.banned_terms = ["forbidden"]
        self.account.brand.save()
        self.plan = make_plan(self.account)
        self.signals = [make_signal(self.account, title=f"S{i}") for i in range(4)]
        self.run = ResearchRun.objects.create(
            account=self.account, plan=self.plan, status="running", started_at=timezone.now(),
            params={"lookback_days": 7})

    def synth(self, topics_out):
        result = FakeResult(TopicSynthesis(topics=topics_out))
        with mock.patch("apps.research.services.platform.run_text", return_value=result) as rt:
            outcome = synthesis.synthesize(self.run)
        return outcome, rt

    def test_validation_rules(self):
        ids = [s.pk for s in self.signals]
        outcome, rt = self.synth([
            topic_draft("بازگشت قهوه دمی به منوی کافه‌ها", ids[:3], hooks=["hook", "forbidden x"]),
            topic_draft("Unknown evidence", [999999]),
            topic_draft("Has Forbidden word", ids[:1]),
            topic_draft("Bad formats", ids[:1], formats=("reel",)),
        ])
        self.assertEqual(outcome.topics, 2)
        self.assertEqual(outcome.dropped_topics, 2)
        topic = TrendTopic.objects.get(title="بازگشت قهوه دمی به منوی کافه‌ها")
        self.assertEqual(topic.hooks, ["hook"])
        self.assertEqual(topic.origin, "ai")
        self.assertEqual(topic.status, "new")
        self.assertEqual(topic.plan, self.plan)
        self.assertEqual(topic.signals.count(), 3)
        self.assertGreater(topic.evidence_score, 0)
        variables = rt.call_args.kwargs["variables"]
        self.assertEqual(len(variables["signals"]), 4)
        self.assertEqual(variables["content_language"], "fa")

    def test_too_few_signals(self):
        TrendSignal.objects.exclude(pk__in=[s.pk for s in self.signals[:2]]).delete()
        with mock.patch("apps.research.services.platform.run_text") as rt:
            outcome = synthesis.synthesize(self.run)
        self.assertEqual(outcome.synthesis, "skipped_too_few_signals")
        rt.assert_not_called()

    def test_replacement_rule(self):
        ids = [s.pk for s in self.signals]
        TrendTopic.objects.create(account=self.account, plan=self.plan, title="Kept",
                                  status="shortlisted")
        TrendTopic.objects.create(account=self.account, plan=self.plan, title="Old",
                                  status="dismissed")
        untouched = [TrendTopic.objects.create(account=self.account, plan=self.plan,
                                               title=f"Untouched {i}") for i in range(2)]
        TrendTopic.objects.create(account=self.account, plan=self.plan, title="Manual",
                                  origin="manual", status="new")
        outcome, rt = self.synth([topic_draft("Kept", ids[:1]), topic_draft("old", ids[:1]),
                                  topic_draft("Fresh", ids[:2])])
        self.assertEqual(outcome.topics, 1)
        titles = set(TrendTopic.objects.values_list("title", flat=True))
        self.assertEqual(titles, {"Kept", "Old", "Manual", "Fresh"})
        self.assertFalse(TrendTopic.objects.filter(pk__in=[t.pk for t in untouched]).exists())
        variables = rt.call_args.kwargs["variables"]
        self.assertEqual({t["title"] for t in variables["existing_topics"]}, {"Kept", "Manual"})
        self.assertEqual(variables["dismissed_topics"], ["Old"])

    def test_no_survivors_keeps_old_topics(self):
        old = TrendTopic.objects.create(account=self.account, plan=self.plan, title="Untouched")
        outcome, _ = self.synth([topic_draft("Nothing", [999999])])
        self.assertEqual((outcome.synthesis, outcome.topics), ("done", 0))
        self.assertTrue(TrendTopic.objects.filter(pk=old.pk).exists())

    def test_failure_rolls_back(self):
        old = TrendTopic.objects.create(account=self.account, plan=self.plan, title="Untouched")
        ids = [s.pk for s in self.signals]
        result = FakeResult(TopicSynthesis(topics=[topic_draft("Fresh", ids[:2])]))
        with mock.patch("apps.research.services.platform.run_text", return_value=result), \
                mock.patch.object(synthesis.evidence, "score_topic",
                                  side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                synthesis.synthesize(self.run)
        self.assertTrue(TrendTopic.objects.filter(pk=old.pk).exists())
        self.assertFalse(TrendTopic.objects.filter(title="Fresh").exists())


class TopicServiceTests(TestCase):
    def test_mark_used(self):
        account = make_account()
        topic = TrendTopic.objects.create(account=account, title="T")
        self.assertEqual(topics.mark_used(topic.pk).status, "used")
        dismissed = TrendTopic.objects.create(account=account, title="D", status="dismissed")
        from apps.core.errors import InvalidTransition

        with self.assertRaises(InvalidTransition):
            topics.mark_used(dismissed.pk)

    def test_manual_topic_without_signals_scores_zero(self):
        account = make_account()
        topic = topics.create_manual(account=account, plan=None, data={"title": "Hand made"},
                                     signals=[])
        self.assertEqual(topic.evidence_score, 0)
        self.assertEqual(set(topic.evidence_breakdown.values()), {0})
        self.assertEqual((topic.origin, topic.status), ("manual", "shortlisted"))
