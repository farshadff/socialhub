from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.ai.providers.fake import fake_text
from apps.planning.models import WeeklyPlan
from apps.research.models import ResearchRun, TrendTopic
from apps.research.services import runs

from . import factories as f


def fields(response):
    return {(item["path"], item["code"]) for item in response.json()["error"]["fields"]}


class APIBase(TestCase):
    def setUp(self):
        self.addCleanup(fake_text.clear)
        patcher = f.freeze()
        patcher.start()
        self.addCleanup(patcher.stop)
        enqueue = mock.patch("apps.core.jobs._enqueue")
        enqueue.start()
        self.addCleanup(enqueue.stop)
        self.operator = f.user()
        self.admin = f.user(admin=True)
        self.account = f.account()
        self.client = APIClient()
        self.client.force_authenticate(self.operator)


class SourceAPITests(APIBase):
    url = "/api/v1/research/sources/"

    def create(self, **body):
        return self.client.post(self.url, {"account": self.account.pk, **body}, format="json")

    def test_create_normalizes_and_labels(self):
        response = self.create(kind="rss", value=" HTTPS://Sprudge.com/feed/ ", label="")
        self.assertEqual(response.status_code, 201, response.json())
        body = response.json()
        self.assertEqual((body["value"], body["label"], body["active"]), ("https://sprudge.com/feed/", "sprudge.com", True))
        self.assertEqual((body["available"], body["unavailable_reason"]), (True, None))
        self.assertTrue(body["created_at"].endswith("Z"))

    def test_errors(self):
        self.create(kind="rss", value="https://sprudge.com/feed/")
        cases = [
            ({"kind": "rss", "value": "https://SPRUDGE.com/feed/"}, ("value", "unique")),
            ({"kind": "manual", "value": "x"}, ("kind", "invalid_choice")),
            ({"kind": "instagram_hashtag", "value": "coffee"}, ("kind", "invalid_choice")),
            ({"kind": "rss", "value": "ftp://example.com/feed"}, ("value", "invalid")),
            ({"kind": "rss", "value": "http://127.0.0.1/feed"}, ("value", "invalid")),
            ({"kind": "web_search", "value": "ab"}, ("value", "min_length")),
            ({"value": "abc"}, ("kind", "required")),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                response = self.create(**body)
                self.assertEqual(response.status_code, 400)
                self.assertIn(expected, fields(response))

    def test_active_limit(self):
        for i in range(8):
            f.source(self.account, "web_search", f"query number {i}")
        response = self.create(kind="web_search", value="ninth query")
        self.assertIn(("active", "limit_reached"), fields(response))
        response = self.create(kind="web_search", value="ninth query", active=False)
        self.assertEqual(response.status_code, 201)
        response = self.client.patch(f"{self.url}{response.json()['id']}/", {"active": True}, format="json")
        self.assertIn(("active", "limit_reached"), fields(response))

    def test_patch_kind_immutable_and_delete_keeps_signals(self):
        source = f.source(self.account, "rss")
        response = self.client.patch(f"{self.url}{source.pk}/", {"kind": "web_search"}, format="json")
        self.assertIn(("kind", "immutable"), fields(response))
        signal = f.signal(self.account, source=source)
        self.assertEqual(self.client.delete(f"{self.url}{source.pk}/").status_code, 204)
        signal.refresh_from_db()
        self.assertIsNone(signal.source)

    def test_delete_blocked_while_running(self):
        source = f.source(self.account, "rss")
        runs.start_run(runs.RunRequest(account=self.account, plan=None, source_ids=None, synthesize=False))
        response = self.client.delete(f"{self.url}{source.pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "job_in_progress")
        self.assertIn("job", response.json()["error"]["details"])

    def test_list_filters_and_account_required(self):
        f.source(self.account, "rss", label="b feed")
        f.source(self.account, "web_search", "coffee query", active=False)
        f.source(f.account(), "rss")
        self.assertIn(("account", "required"), fields(self.client.get(self.url)))
        self.assertEqual(self.client.get(f"{self.url}?account=999999").status_code, 404)
        body = self.client.get(f"{self.url}?account={self.account.pk}").json()
        self.assertEqual(body["count"], 2)
        self.assertEqual([r["kind"] for r in body["results"]], ["rss", "web_search"])
        body = self.client.get(f"{self.url}?account={self.account.pk}&active=false&kind=web_search").json()
        self.assertEqual(body["count"], 1)

    @override_settings(SOCIALHUB_AI_TEXT_PROVIDER="anthropic", ANTHROPIC_API_KEY="")
    def test_unavailable_web_search(self):
        f.source(self.account, "web_search", "coffee query")
        body = self.client.get(f"{self.url}?account={self.account.pk}").json()
        self.assertEqual(body["results"][0]["unavailable_reason"], "provider_not_configured")

    def test_archived_account(self):
        source = f.source(self.account, "rss")
        self.account.status = "archived"
        self.account.save()
        self.assertEqual(self.create(kind="rss", value="https://a.example.com/f").status_code, 409)
        response = self.client.patch(f"{self.url}{source.pk}/", {"active": False}, format="json")
        self.assertEqual(response.json()["error"]["code"], "invalid_transition")
        self.assertEqual(self.client.get(f"{self.url}?account={self.account.pk}").status_code, 200)

    def test_admin_can_also_manage(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.create(kind="web_search", value="admin query").status_code, 201)


class RunAPITests(APIBase):
    url = "/api/v1/research/runs/"

    def setUp(self):
        super().setUp()
        self.source = f.source(self.account, "rss", "https://feed.example.com/rss")

    def post(self, **body):
        return self.client.post(self.url, {"account": self.account.pk, **body}, format="json")

    def test_start_returns_job_and_picks_plan(self):
        plan = f.plan(self.account)
        response = self.post()
        self.assertEqual(response.status_code, 202, response.json())
        job = response.json()["job"]
        self.assertEqual((job["kind"], job["status"], job["target_type"]), ("research.run", "queued", "research_run"))
        run = ResearchRun.objects.get(pk=int(job["target_id"]))
        self.assertEqual(run.plan, plan)
        self.assertEqual(run.params, {"lookback_days": 7, "source_ids": None, "collect": True, "synthesize": True})

    def test_explicit_null_plan(self):
        f.plan(self.account)
        response = self.post(plan=None)
        self.assertIsNone(ResearchRun.objects.get(pk=int(response.json()["job"]["target_id"])).plan)

    def test_errors(self):
        other = f.account()
        closed = f.plan(self.account, status=WeeklyPlan.Status.CLOSED)
        inactive = f.source(self.account, "rss", active=False)
        cases = [
            ({"plan": f.plan(other).pk}, ("plan", "invalid")),
            ({"plan": closed.pk}, ("plan", "invalid")),
            ({"source_ids": [self.source.pk, inactive.pk]}, ("source_ids.1", "invalid")),
            ({"lookback_days": 0}, ("lookback_days", "min_value")),
            ({"lookback_days": 31}, ("lookback_days", "max_value")),
            ({"collect": False, "synthesize": False}, ("", "nothing_to_do")),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                response = self.post(**body)
                self.assertEqual(response.status_code, 400)
                self.assertIn(expected, fields(response))
        response = self.client.post(self.url, {"account": 999999}, format="json")
        self.assertIn(("account", "does_not_exist"), fields(response))

    def test_no_active_sources(self):
        self.source.active = False
        self.source.save()
        self.assertIn(("source_ids", "no_active_sources"), fields(self.post()))
        self.assertEqual(self.post(collect=False).status_code, 202)

    def test_conflict_and_provider(self):
        first = self.post().json()["job"]
        response = self.post()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["details"]["job"]["id"], first["id"])
        self.assertTrue(response.json()["error"]["retryable"])
        with override_settings(SOCIALHUB_AI_TEXT_PROVIDER="anthropic", ANTHROPIC_API_KEY=""):
            other = f.account()
            f.source(other, "rss")
            response = self.client.post(self.url, {"account": other.pk}, format="json")
            self.assertEqual((response.status_code, response.json()["error"]["code"]), (503, "provider_not_configured"))
            response = self.client.post(self.url, {"account": other.pk, "synthesize": False}, format="json")
            self.assertEqual(response.status_code, 202)

    def test_archived(self):
        self.account.status = "archived"
        self.account.save()
        self.assertEqual(self.post().status_code, 409)

    def test_list_and_detail(self):
        job = self.post(synthesize=False).json()["job"]
        run = ResearchRun.objects.get(pk=int(job["target_id"]))
        run.stats = {"by_source": {str(self.source.pk): {"signals": 3, "duplicates": 1, "status": "ok"},
                                   "999": {"signals": 0, "duplicates": 0, "status": "error:timeout"}}}
        run.save()
        body = self.client.get(f"{self.url}?account={self.account.pk}").json()
        self.assertEqual(body["count"], 1)
        row = body["results"][0]
        self.assertEqual(row["started_by"]["id"], self.operator.pk)
        self.assertEqual(row["job"]["id"], job["id"])
        detail = self.client.get(f"{self.url}{run.pk}/").json()
        sources = {s["source_id"]: s for s in detail["sources"]}
        self.assertEqual(sources[self.source.pk]["kind"], "rss")
        self.assertIsNone(sources[999]["kind"])


class SignalAPITests(APIBase):
    url = "/api/v1/research/signals/"

    def post(self, **body):
        return self.client.post(self.url, {"account": self.account.pk, **body}, format="json")

    def test_manual_signal_and_instagram_duplicate(self):
        response = self.post(
            url="https://www.instagram.com/reel/DCx1abcDEF/?igsh=MWx0",
            title="Competitor reel",
            excerpt="Three-step cold brew.",
            author="@somecoffeebrand",
            published_at="2026-11-20T16:30:00Z",
            metrics={"likes": 9200, "comments": 310, "views": 180000},
        )
        self.assertEqual(response.status_code, 201, response.json())
        body = response.json()
        self.assertEqual((body["kind"], body["run"], body["source"]), ("manual", None, None))
        self.assertNotIn("raw", body)
        again = self.post(url="https://instagram.com/p/DCx1abcDEF/", title="Same")
        self.assertIn(("url", "unique"), fields(again))
        self.assertEqual(again.json()["error"]["details"]["signal_id"], body["id"])

    def test_errors(self):
        used = f.topic(self.account, status="used")
        foreign = f.topic(f.account())
        cases = [
            ({"url": "https://a.example.com"}, ("title", "required")),
            ({"title": "Only title"}, ("", "url_or_excerpt_required")),
            ({"title": "T", "url": "ftp://a.example.com"}, ("url", "invalid")),
            ({"title": "T", "excerpt": "e", "metrics": {"shares": 1}}, ("metrics.shares", "invalid")),
            ({"title": "T", "excerpt": "e", "metrics": {"likes": -1}}, ("metrics.likes", "min_value")),
            ({"title": "T", "excerpt": "e", "topic": foreign.pk}, ("topic", "invalid")),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                self.assertIn(expected, fields(self.post(**body)))
        response = self.post(title="T", excerpt="e", topic=used.pk)
        self.assertEqual(response.status_code, 409)
        self.post(title="T", excerpt="same words", author="@a")
        self.assertIn(("excerpt", "unique"), fields(self.post(title="T2", excerpt="Same  words", author="@A")))

    def test_attach_to_topic_rescores(self):
        item = f.topic(self.account)
        self.assertEqual(item.evidence_score, 0)
        response = self.post(title="T", url="https://a.example.com/x", topic=item.pk)
        self.assertEqual(response.json()["topic_ids"], [item.pk])
        item.refresh_from_db()
        self.assertGreater(item.evidence_score, 0)

    def test_list_filters(self):
        source = f.source(self.account, "rss")
        item = f.topic(self.account)
        a = f.signal(self.account, source=source, title="Filter coffee")
        f.signal(self.account, kind="manual", title="Cold brew", author="@brand")
        item.signals.add(a)
        base = f"{self.url}?account={self.account.pk}"
        self.assertEqual(self.client.get(base).json()["count"], 2)
        self.assertEqual(self.client.get(f"{base}&source={source.pk}").json()["count"], 1)
        self.assertEqual(self.client.get(f"{base}&kind=manual").json()["count"], 1)
        self.assertEqual(self.client.get(f"{base}&topic={item.pk}").json()["count"], 1)
        self.assertEqual(self.client.get(f"{base}&unassigned=true").json()["count"], 1)
        self.assertEqual(self.client.get(f"{base}&q=BRAND").json()["count"], 1)
        row = self.client.get(f"{base}&topic={item.pk}").json()["results"][0]
        self.assertEqual(row["source"], {"id": source.pk, "kind": "rss", "label": source.label})
        self.assertEqual(row["topic_ids"], [item.pk])


class TopicAPITests(APIBase):
    url = "/api/v1/research/topics/"

    def setUp(self):
        super().setUp()
        self.plan = f.plan(self.account)
        self.signals = [f.signal(self.account) for _ in range(2)]

    def test_manual_topic(self):
        response = self.client.post(self.url, {
            "account": self.account.pk, "plan": self.plan.pk, "title": "راهنمای خرید آسیاب دستی",
            "hooks": ["قبل از خرید آسیاب، این سه چیز را بدان"], "suggested_formats": ["reel"],
            "keywords": ["آسیاب دستی"], "signal_ids": [s.pk for s in self.signals],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        body = response.json()
        self.assertEqual((body["origin"], body["status"], body["run"], body["signal_count"]), ("manual", "shortlisted", None, 2))
        self.assertGreater(body["evidence_score"], 0)
        empty = self.client.post(self.url, {"account": self.account.pk, "title": "No evidence"}, format="json").json()
        self.assertEqual(empty["evidence_score"], 0)
        self.assertEqual(set(empty["evidence_breakdown"].values()), {0})
        self.assertEqual(empty["plan"], self.plan.pk)  # default plan

    def test_manual_topic_errors(self):
        foreign_signal = f.signal(f.account())
        f.topic(self.account, plan=self.plan, title="Taken")
        cases = [
            ({"title": "ab"}, ("title", "min_length")),
            ({"title": "Fine", "hooks": ["x" * 161]}, ("hooks.0", "max_length")),
            ({"title": "Fine", "suggested_formats": ["tiktok"]}, ("suggested_formats.0", "invalid_choice")),
            ({"title": "Fine", "signal_ids": [self.signals[0].pk, foreign_signal.pk]}, ("signal_ids.1", "does_not_exist")),
            ({"title": "Fine", "plan": f.plan(f.account()).pk}, ("plan", "invalid")),
            ({"title": "TAKEN", "plan": self.plan.pk}, ("title", "unique")),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                response = self.client.post(self.url, {"account": self.account.pk, **body}, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn(expected, fields(response))

    def test_list_filters_and_ordering(self):
        low = f.topic(self.account, plan=self.plan, title="Low")
        high = f.topic(self.account, plan=self.plan, title="High")
        TrendTopic.objects.filter(pk=high.pk).update(evidence_score=90)
        TrendTopic.objects.filter(pk=low.pk).update(evidence_score=10)
        f.topic(self.account, plan=self.plan, status="dismissed")
        f.topic(self.account, plan=None, title="Planless")
        base = f"{self.url}?account={self.account.pk}"
        body = self.client.get(f"{base}&status=new,shortlisted&plan={self.plan.pk}").json()
        self.assertEqual([r["title"] for r in body["results"]], ["High", "Low"])
        self.assertEqual(self.client.get(f"{base}&plan=none").json()["count"], 1)
        self.assertEqual(self.client.get(f"{base}&min_evidence=50").json()["count"], 1)
        self.assertIn(("min_evidence", "max_value"), fields(self.client.get(f"{base}&min_evidence=101")))
        self.assertEqual(self.client.get(f"{base}&q=a").json()["count"] >= 1, True)

    def test_detail_and_patch_rules(self):
        item = f.topic(self.account, plan=self.plan, signals=self.signals[:1])
        detail = self.client.get(f"{self.url}{item.pk}/").json()
        self.assertEqual([s["id"] for s in detail["signals"]], [self.signals[0].pk])

        response = self.client.patch(f"{self.url}{item.pk}/", {"hooks": ["New hook"]}, format="json")
        self.assertEqual(response.json()["status"], "shortlisted")  # auto-shortlist on edit

        response = self.client.patch(
            f"{self.url}{item.pk}/", {"signal_ids": [s.pk for s in self.signals]}, format="json"
        )
        self.assertEqual(response.json()["signal_count"], 2)

        response = self.client.patch(f"{self.url}{item.pk}/", {"status": "dismissed"}, format="json")
        self.assertEqual(response.json()["status"], "dismissed")
        response = self.client.patch(f"{self.url}{item.pk}/", {"status": "shortlisted"}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["details"], {"status": "dismissed", "allowed_statuses": ["new"]})
        response = self.client.patch(f"{self.url}{item.pk}/", {"status": "used"}, format="json")
        self.assertEqual(response.status_code, 409)

        used = f.topic(self.account, status="used")
        response = self.client.patch(f"{self.url}{used.pk}/", {"title": "Changed"}, format="json")
        self.assertEqual(response.json()["error"]["details"]["allowed_statuses"], [])
        self.assertIn(("title", "blank"), fields(self.client.patch(f"{self.url}{item.pk}/", {"title": ""}, format="json")))
        missing = self.client.get(f"{self.url}999999/")
        self.assertEqual((missing.status_code, missing.json()["error"]["code"]), (404, "not_found"))
        missing = self.client.patch(f"{self.url}999999/", {"title": "x"}, format="json")
        self.assertEqual(missing.json()["error"]["code"], "not_found")
