from datetime import timedelta
from unittest import mock

from django.test import TestCase

from apps.ai.providers.fake import fake_text
from apps.core.jobs import start_job
from apps.research.models import ResearchRun, TrendTopic
from apps.research.services import synthesis, topics

from . import factories as f


def topic_json(title, signal_ids, hooks=None, formats=None):
    return {
        "title": title,
        "summary": "Summary",
        "why_now": "Now",
        "hooks": hooks or ["Hook one", "Hook two"],
        "suggested_formats": formats or ["reel"],
        "keywords": ["k1", "k2", "k3"],
        "signal_ids": signal_ids,
    }


class SynthesisTests(TestCase):
    def setUp(self):
        self.addCleanup(fake_text.clear)
        patcher = f.freeze()
        patcher.start()
        self.addCleanup(patcher.stop)
        self.account = f.account()
        self.plan = f.plan(self.account)
        self.signals = [
            f.signal(self.account, published_at=f.NOW - timedelta(days=i)) for i in range(1, 5)
        ]
        job = start_job("research.run", target_id="synth-test", account=self.account)
        self.run = ResearchRun.objects.create(
            account=self.account, plan=self.plan, job=job, params={"lookback_days": 7},
            started_at=f.NOW,
        )

    def respond(self, *drafts):
        fake_text.set("research.synthesize_topics", {"topics": list(drafts)})

    def test_validation_rules(self):
        brand = self.account.brand_profile
        brand.banned_terms = ["forbidden"]
        brand.save()
        ids = [s.pk for s in self.signals]
        self.respond(
            topic_json("Good topic", ids[:2] + [999999]),
            topic_json("Only unknown evidence", [999999]),
            topic_json("A FORBIDDEN title", ids),
            topic_json("Hooks get cleaned", ids, hooks=["fine hook", "forbidden hook"]),
            topic_json("All hooks banned", ids, hooks=["forbidden one", "Forbidden two"]),
            topic_json("good   TOPIC", ids),
        )
        outcome = synthesis.synthesize(self.run)
        self.assertEqual((outcome.topics, outcome.dropped), (2, 4))
        good = TrendTopic.objects.get(title="Good topic")
        self.assertEqual(sorted(good.signals.values_list("pk", flat=True)), sorted(ids[:2]))
        self.assertEqual((good.origin, good.status, good.plan), ("ai", "new", self.plan))
        self.assertEqual(TrendTopic.objects.get(title="Hooks get cleaned").hooks, ["fine hook"])

    def test_replacement_rules(self):
        ids = [s.pk for s in self.signals]
        shortlisted = f.topic(self.account, plan=self.plan, title="Kept shortlist", status="shortlisted")
        dismissed = f.topic(self.account, plan=self.plan, title="Kept dismissed", status="dismissed")
        untouched = [f.topic(self.account, plan=self.plan, title=f"Old {i}") for i in range(2)]
        other_plan = f.topic(self.account, plan=None, title="No plan topic")
        manual = f.topic(self.account, plan=self.plan, title="Manual", origin="manual")
        captured = {}

        def respond(variables):
            captured.update(variables)
            return {"topics": [
                topic_json("kept SHORTLIST", ids),
                topic_json("Kept dismissed", ids),
                topic_json("Fresh topic", ids),
            ]}

        fake_text.set("research.synthesize_topics", respond)
        outcome = synthesis.synthesize(self.run)
        self.assertEqual(outcome.topics, 1)
        for kept in (shortlisted, dismissed, other_plan, manual):
            self.assertTrue(TrendTopic.objects.filter(pk=kept.pk).exists())
        self.assertFalse(TrendTopic.objects.filter(pk__in=[t.pk for t in untouched]).exists())
        self.assertIn({"title": "Kept shortlist", "keywords": ["a", "b", "c"]}, captured["existing_topics"])
        self.assertEqual(captured["dismissed_topics"], ["Kept dismissed"])

    def test_nothing_survives_keeps_old_topics(self):
        old = f.topic(self.account, plan=self.plan, title="Old")
        self.respond(topic_json("Bad", [999999]))
        outcome = synthesis.synthesize(self.run)
        self.assertEqual((outcome.topics, outcome.state), (0, "done"))
        self.assertTrue(TrendTopic.objects.filter(pk=old.pk).exists())

    def test_transaction_rolls_back(self):
        old = f.topic(self.account, plan=self.plan, title="Old")
        self.respond(topic_json("New", [self.signals[0].pk]))
        with mock.patch.object(synthesis.evidence, "rescore", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                synthesis.synthesize(self.run)
        self.assertTrue(TrendTopic.objects.filter(pk=old.pk).exists())
        self.assertFalse(TrendTopic.objects.filter(title="New").exists())

    def test_too_few_signals(self):
        self.signals[0].delete()
        self.signals[1].delete()
        fake_text.set("research.synthesize_topics", AssertionError("must not be called"))
        self.assertEqual(synthesis.synthesize(self.run).state, "skipped_too_few_signals")

    def test_persian_text_kept_unchanged(self):
        title = "قهوه‌ی دمی در خانه"
        self.respond(topic_json(title, [self.signals[0].pk]))
        synthesis.synthesize(self.run)
        self.assertTrue(TrendTopic.objects.filter(title=title).exists())


class TopicServiceTests(TestCase):
    def setUp(self):
        self.account = f.account()

    def test_mark_used_and_release(self):
        item = f.topic(self.account)
        self.assertEqual(topics.mark_used(item.pk).status, "used")
        self.assertEqual(topics.release(item.pk).status, "shortlisted")
        dismissed = f.topic(self.account, status="dismissed")
        from apps.core.exceptions import InvalidTransition

        with self.assertRaises(InvalidTransition):
            topics.mark_used(dismissed.pk)

    def test_engagement_reference_set(self):
        with f.freeze():
            sigs = [
                f.signal(self.account, kind="manual", metrics={"likes": n}) for n in (10, 20, 30, 40, 50)
            ]
            item = f.topic(self.account, signals=[sigs[3]])
            from apps.research.services import evidence

            score, breakdown = evidence.score_topic(item, f.NOW)
        self.assertEqual(breakdown["engagement"], 80)
