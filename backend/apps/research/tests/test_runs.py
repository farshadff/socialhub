from unittest import mock

import httpx2 as httpx
from django.test import TestCase

from apps.ai.errors import ProviderError
from apps.ai.providers.fake import fake_text
from apps.core import http
from apps.core.jobs import JobInProgress, run_job
from apps.core.models import JobRun
from apps.planning.models import WeeklyPlan
from apps.research.models import ResearchRun, TrendSignal, TrendTopic
from apps.research.services import runs
from apps.research.services.runs import RunRequest

from . import factories as f
from .feeds import ATOM, RSS


def feed_transport(routes):
    def handler(request):
        body = routes.get(str(request.url))
        if body is None:
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, content=body)

    return httpx.MockTransport(handler)


class RunTests(TestCase):
    def setUp(self):
        self.addCleanup(fake_text.clear)
        for patcher in (
            mock.patch.object(http, "resolve_host", lambda host: ["93.184.216.34"]),
            mock.patch.object(http, "_sleep"),
            f.freeze(),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.user = f.user()
        self.account = f.account()
        self.web1 = f.source(self.account, "web_search", "coffee trends")
        self.web2 = f.source(self.account, "web_search", "brew methods [fixture:out_of_list_url]")
        self.rss = f.source(self.account, "rss", "https://feed.example.com/rss")
        self.atom = f.source(self.account, "rss", "https://atom.example.com/feed")
        self.transport = feed_transport({
            "https://feed.example.com/rss": RSS,
            "https://atom.example.com/feed": ATOM,
        })
        patcher = mock.patch.object(runs.COLLECTORS["rss"], "transport", self.transport, create=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def start(self, **kwargs):
        options = {"account": self.account, "plan": None, "source_ids": None}
        options.update(kwargs)
        return runs.start_run(RunRequest(**options), user=self.user)

    def execute(self, **kwargs):
        job = self.start(**kwargs)
        run_job(job.id)
        job.refresh_from_db()
        return job, ResearchRun.objects.get(job=job)

    def test_full_run_collects_dedupes_and_synthesizes(self):
        job, run = self.execute()
        self.assertEqual(job.status, "succeeded", job.error_detail)
        self.assertEqual(run.status, "completed")
        by_source = run.stats["by_source"]
        self.assertEqual(by_source[str(self.web1.pk)]["status"], "ok")
        self.assertEqual(by_source[str(self.web1.pk)]["signals"], 2)
        # web2 finds the same two example.com links (one out-of-list dropped) → duplicates.
        self.assertEqual(by_source[str(self.web2.pk)]["duplicates"], 1)
        # RSS: two link forms of one post → one signal and one duplicate.
        self.assertEqual(by_source[str(self.rss.pk)]["duplicates"], 1)
        self.assertEqual(TrendSignal.objects.filter(url__contains="filter-back").count(), 1)
        self.assertEqual(run.stats["synthesis"], "done")
        self.assertEqual(run.stats["topics"], 2)  # valid + non-repeated third; unknown-ID dropped
        self.assertEqual(run.stats["dropped_topics"], 1)
        self.assertEqual(job.result["run_id"], run.pk)
        self.assertEqual(job.progress, 100)
        self.rss.refresh_from_db()
        self.assertEqual(self.rss.last_status, "ok")
        topic = TrendTopic.objects.filter(run=run).order_by("-evidence_score").first()
        self.assertGreater(topic.evidence_score, 0)
        self.assertEqual(set(topic.evidence_breakdown), {"signal_count", "source_diversity", "recency", "engagement"})
        self.assertTrue(TrendTopic.objects.filter(run=run, title="بازگشت قهوه دمی به منوی کافه‌ها").exists())

        # Second run: nothing new, every source "empty", duplicates counted.
        job2, run2 = self.execute(synthesize=False)
        self.assertEqual(run2.stats["signals"], 0)
        self.assertGreater(run2.stats["duplicates"], 0)
        self.assertEqual({v["status"] for v in run2.stats["by_source"].values()}, {"empty"})

    def test_partial_failure(self):
        broken = f.source(self.account, "rss", "https://broken.example.com/feed")
        job, run = self.execute(synthesize=False)
        self.assertEqual(run.status, "completed")
        self.assertEqual(run.stats["by_source"][str(broken.pk)]["status"], "error:timeout")
        broken.refresh_from_db()
        self.assertEqual(broken.last_status, "error:timeout")

    def test_all_sources_failed(self):
        bad = f.source(self.account, "rss", "https://down.example.com/feed")
        job, run = self.execute(source_ids=[bad.pk])
        self.assertEqual((job.status, job.error_code), ("failed", "all_sources_failed"))
        self.assertEqual(run.status, "failed")
        self.assertEqual(run.stats["synthesis"], "skipped")

    def test_one_run_per_account_and_stale_recovery(self):
        job = self.start()
        with self.assertRaises(JobInProgress) as caught:
            self.start()
        self.assertEqual(caught.exception.details["job"]["id"], str(job.id))
        ResearchRun.objects.filter(job=job).update(started_at=f.NOW - runs.STALE_AFTER * 2)
        job2 = self.start()
        job.refresh_from_db()
        self.assertEqual((job.status, job.error_code), ("failed", "stale_run"))
        self.assertNotEqual(job2.id, job.id)

    def test_redelivery_of_finished_run_does_nothing(self):
        job, run = self.execute(synthesize=False)
        count = TrendSignal.objects.count()
        JobRun.objects.filter(pk=job.pk).update(status="running")
        run_job(job.id)
        self.assertEqual(TrendSignal.objects.count(), count)

    def test_synthesis_failure_keeps_signals_and_topics(self):
        old = f.topic(self.account, title="Existing AI topic")
        fake_text.set("research.synthesize_topics", ProviderError("unavailable"))
        job, run = self.execute()
        self.assertEqual((job.status, job.error_code, job.error_detail), ("failed", "provider_error", "unavailable"))
        self.assertTrue(TrendSignal.objects.filter(run=run).exists())
        self.assertTrue(TrendTopic.objects.filter(pk=old.pk).exists())

    def test_too_few_signals_skips_synthesis(self):
        job, run = self.execute(source_ids=[self.atom.pk])
        self.assertEqual(run.stats["synthesis"], "skipped_too_few_signals")
        self.assertEqual(run.stats["topics"], 0)

    def test_default_plan(self):
        past = f.plan(self.account, week_start=f.NOW.date().replace(day=7))
        draft = f.plan(self.account, week_start=f.NOW.date().replace(day=28))
        closed = f.plan(self.account, week_start=f.NOW.date().replace(day=21), status=WeeklyPlan.Status.CLOSED)
        self.assertEqual(runs.default_plan(self.account), draft)
        self.assertNotIn(runs.default_plan(self.account), (past, closed))

    def test_autopilot_requests_rank(self):
        plan = f.plan(self.account, status=WeeklyPlan.Status.ACTIVE)
        self.account.autopilot = {"selection": True}
        self.account.save()
        fake_module = mock.MagicMock()
        with mock.patch.dict("sys.modules", {
            "apps.selection": mock.MagicMock(),
            "apps.selection.services": mock.MagicMock(),
            "apps.selection.services.ranking": fake_module,
        }):
            with mock.patch("apps.core.jobs._enqueue"), self.captureOnCommitCallbacks(execute=True):
                job = self.start(plan=plan, synthesize=False)
                run_job(job.id)
        fake_module.request_rank.assert_called_once_with(plan, reason="research_completed")

    def test_soft_time_limit_marks_run_failed(self):
        from celery.exceptions import SoftTimeLimitExceeded

        job = self.start(synthesize=False)
        with mock.patch.object(runs, "collect", side_effect=SoftTimeLimitExceeded()):
            run_job(job.id)
        job.refresh_from_db()
        self.assertEqual(job.error_code, "timeout")
        self.assertEqual(ResearchRun.objects.get(job=job).status, "failed")
