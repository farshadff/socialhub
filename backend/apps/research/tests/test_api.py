from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import JobRun

from ..models import ResearchRun, ResearchSource, TrendSignal, TrendTopic
from .helpers import (
    make_account,
    make_plan,
    make_signal,
    make_source,
    make_user,
    provider_configured,
)


def fields(response):
    return {(f["path"], f["code"]) for f in response.json()["error"]["fields"]}


class APITestCase(TestCase):
    def setUp(self):
        self.user = make_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.account = make_account()
        patcher = provider_configured(True)
        patcher.start()
        self.addCleanup(patcher.stop)


class SourceAPITests(APITestCase):
    url = "/api/v1/research/sources/"

    def test_list_requires_account(self):
        self.assertEqual(fields(self.client.get(self.url)), {("account", "required")})
        self.assertEqual(self.client.get(self.url, {"account": 99999}).status_code, 404)

    def test_create_normalizes_and_labels(self):
        response = self.client.post(self.url, {"account": self.account.pk, "kind": "rss",
                                               "value": " HTTPS://Sprudge.com/feed/ ",
                                               "label": ""}, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        body = response.json()
        self.assertEqual((body["value"], body["label"], body["active"]),
                         ("https://sprudge.com/feed/", "sprudge.com", True))
        self.assertEqual((body["available"], body["unavailable_reason"]), (True, None))
        dup = self.client.post(self.url, {"account": self.account.pk, "kind": "rss",
                                          "value": "https://SPRUDGE.com/feed/"}, format="json")
        self.assertEqual(fields(dup), {("value", "unique")})

    def test_rejected_kinds_and_values(self):
        for kind in ("manual", "instagram_hashtag", "instagram_account"):
            r = self.client.post(self.url, {"account": self.account.pk, "kind": kind,
                                            "value": "x"}, format="json")
            self.assertIn(("kind", "invalid_choice"), fields(r))
        for value in ("ftp://example.com/feed", "http://127.0.0.1/feed"):
            r = self.client.post(self.url, {"account": self.account.pk, "kind": "rss",
                                            "value": value}, format="json")
            self.assertEqual(fields(r), {("value", "invalid")})

    def test_active_limit(self):
        for i in range(8):
            make_source(self.account, kind="web_search", value=f"query number {i}")
        body = {"account": self.account.pk, "kind": "web_search", "value": "ninth query"}
        r = self.client.post(self.url, body, format="json")
        self.assertEqual(fields(r), {("active", "limit_reached")})
        r = self.client.post(self.url, {**body, "active": False}, format="json")
        self.assertEqual(r.status_code, 201)
        r = self.client.patch(f"{self.url}{r.json()['id']}/", {"active": True}, format="json")
        self.assertEqual(fields(r), {("active", "limit_reached")})

    def test_kind_is_immutable(self):
        source = make_source(self.account)
        r = self.client.patch(f"{self.url}{source.pk}/", {"kind": "web_search"}, format="json")
        self.assertEqual(fields(r), {("kind", "immutable")})

    def test_delete_keeps_signals(self):
        source = make_source(self.account)
        signal = make_signal(self.account, source=source)
        self.assertEqual(self.client.delete(f"{self.url}{source.pk}/").status_code, 204)
        signal.refresh_from_db()
        self.assertIsNone(signal.source)

    def test_delete_blocked_while_running(self):
        source = make_source(self.account)
        job = JobRun.objects.create(kind="research.run", target_type="research_run",
                                    target_id="1", status="running", account=self.account)
        ResearchRun.objects.create(account=self.account, job=job, status="running",
                                   started_at=timezone.now())
        r = self.client.delete(f"{self.url}{source.pk}/")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["code"], "job_in_progress")
        self.assertEqual(r.json()["error"]["details"]["job"]["id"], str(job.id))

    def test_unavailable_web_search(self):
        make_source(self.account, kind="web_search", value="coffee trends")
        make_source(self.account)
        with provider_configured(False):
            rows = self.client.get(self.url, {"account": self.account.pk}).json()["results"]
        by_kind = {r["kind"]: r for r in rows}
        self.assertEqual(by_kind["web_search"]["unavailable_reason"], "provider_not_configured")
        self.assertTrue(by_kind["rss"]["available"])

    def test_archived_account(self):
        self.account.status = "archived"
        self.account.save()
        r = self.client.post(self.url, {"account": self.account.pk, "kind": "rss",
                                        "value": "https://sprudge.com/feed/"}, format="json")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (409, "invalid_transition"))

    def test_filters(self):
        make_source(self.account)
        make_source(self.account, kind="web_search", value="coffee trends", active=False)
        r = self.client.get(self.url, {"account": self.account.pk, "kind": "web_search",
                                       "active": "false"})
        self.assertEqual(r.json()["count"], 1)


class RunAPITests(APITestCase):
    url = "/api/v1/research/runs/"

    def test_validation_rows(self):
        acct = self.account.pk
        r = self.client.post(self.url, {"account": acct, "collect": False, "synthesize": False},
                             format="json")
        self.assertEqual(fields(r), {("non_field_errors", "nothing_to_do")})
        r = self.client.post(self.url, {"account": acct}, format="json")
        self.assertEqual(fields(r), {("source_ids", "no_active_sources")})
        make_source(self.account)
        inactive = make_source(self.account, value="https://b.example/feed", active=False)
        r = self.client.post(self.url, {"account": acct, "source_ids": [inactive.pk]},
                             format="json")
        self.assertEqual(fields(r), {("source_ids.0", "invalid")})
        r = self.client.post(self.url, {"account": acct, "lookback_days": 31}, format="json")
        self.assertEqual(fields(r), {("lookback_days", "max_value")})
        other = make_plan(make_account(handle="other"))
        r = self.client.post(self.url, {"account": acct, "plan": other.pk}, format="json")
        self.assertEqual(fields(r), {("plan", "invalid")})

    def test_provider_missing(self):
        make_source(self.account)
        with provider_configured(False):
            r = self.client.post(self.url, {"account": self.account.pk}, format="json")
        self.assertEqual((r.status_code, r.json()["error"]["code"]),
                         (503, "provider_not_configured"))

    def test_start_picks_default_plan_and_conflicts(self):
        make_source(self.account)
        plan = make_plan(self.account, days_ahead=3)
        r = self.client.post(self.url, {"account": self.account.pk}, format="json")
        self.assertEqual(r.status_code, 202, r.json())
        job = r.json()["job"]
        self.assertEqual((job["kind"], job["status"], job["target_type"]),
                         ("research.run", "queued", "research_run"))
        run = ResearchRun.objects.get(pk=int(job["target_id"]))
        self.assertEqual(run.plan, plan)
        self.assertEqual(run.params["lookback_days"], 7)
        again = self.client.post(self.url, {"account": self.account.pk}, format="json")
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["error"]["details"]["job"]["id"], job["id"])

    def test_stale_run_does_not_block(self):
        make_source(self.account)
        job = JobRun.objects.create(kind="research.run", target_type="research_run",
                                    target_id="999", status="running", account=self.account)
        stale = ResearchRun.objects.create(account=self.account, job=job, status="running",
                                           started_at=timezone.now() - timedelta(minutes=40))
        r = self.client.post(self.url, {"account": self.account.pk}, format="json")
        self.assertEqual(r.status_code, 202)
        stale.refresh_from_db()
        job.refresh_from_db()
        self.assertEqual((stale.status, job.error_code), ("failed", "stale_run"))

    def test_list_and_detail(self):
        source = make_source(self.account, label="sprudge.com")
        job = JobRun.objects.create(kind="research.run", target_type="research_run",
                                    target_id="1", status="succeeded", account=self.account)
        run = ResearchRun.objects.create(
            account=self.account, job=job, status="completed", started_at=timezone.now(),
            started_by=self.user,
            stats={"signals": 1, "duplicates": 0, "topics": 0, "synthesis": "skipped",
                   "by_source": {str(source.pk): {"signals": 1, "duplicates": 0, "status": "ok"},
                                 "424242": {"signals": 0, "duplicates": 0,
                                            "status": "error:timeout"}}})
        rows = self.client.get(self.url, {"account": self.account.pk}).json()["results"]
        self.assertEqual(rows[0]["job"]["status"], "succeeded")
        self.assertEqual(rows[0]["started_by"]["id"], self.user.pk)
        detail = self.client.get(f"{self.url}{run.pk}/").json()
        by_id = {s["source_id"]: s for s in detail["sources"]}
        self.assertEqual(by_id[source.pk]["label"], "sprudge.com")
        self.assertIsNone(by_id[424242]["kind"])


class SignalAPITests(APITestCase):
    url = "/api/v1/research/signals/"

    def test_manual_signal_and_instagram_duplicate(self):
        body = {"account": self.account.pk,
                "url": "https://www.instagram.com/reel/DCx1abcDEF/?igsh=MWx0",
                "title": "Competitor reel", "metrics": {"likes": 9200, "views": 180000}}
        r = self.client.post(self.url, body, format="json")
        self.assertEqual(r.status_code, 201, r.json())
        first = r.json()
        self.assertEqual((first["kind"], first["run"], first["source"]), ("manual", None, None))
        dup = self.client.post(self.url, {**body, "url": "https://instagram.com/p/DCx1abcDEF/"},
                               format="json")
        self.assertEqual(fields(dup), {("url", "unique")})
        self.assertEqual(dup.json()["error"]["details"]["signal_id"], first["id"])

    def test_manual_signal_validation(self):
        acct = self.account.pk
        r = self.client.post(self.url, {"account": acct, "url": "https://a.example"},
                             format="json")
        self.assertEqual(fields(r), {("title", "required")})
        r = self.client.post(self.url, {"account": acct, "title": "T"}, format="json")
        self.assertEqual(fields(r), {("non_field_errors", "url_or_excerpt_required")})
        r = self.client.post(self.url, {"account": acct, "title": "T", "url": "ftp://x.example"},
                             format="json")
        self.assertEqual(fields(r), {("url", "invalid")})
        r = self.client.post(self.url, {"account": acct, "title": "T", "excerpt": "E",
                                        "metrics": {"shares": 1, "likes": -1}}, format="json")
        self.assertEqual(fields(r), {("metrics.shares", "invalid"), ("metrics.likes", "min_value")})

    def test_attach_to_topic_rescores(self):
        topic = TrendTopic.objects.create(account=self.account, title="T", status="shortlisted")
        r = self.client.post(self.url, {"account": self.account.pk, "title": "T",
                                        "excerpt": "Seen in DMs", "topic": topic.pk},
                             format="json")
        self.assertEqual(r.status_code, 201)
        topic.refresh_from_db()
        self.assertEqual(topic.signals.count(), 1)
        self.assertGreater(topic.evidence_score, 0)
        used = TrendTopic.objects.create(account=self.account, title="U", status="used")
        r = self.client.post(self.url, {"account": self.account.pk, "title": "T2",
                                        "excerpt": "Other", "topic": used.pk}, format="json")
        self.assertEqual(r.status_code, 409)

    def test_filters(self):
        topic = TrendTopic.objects.create(account=self.account, title="T")
        linked = make_signal(self.account, title="Linked coffee")
        topic.signals.add(linked)
        make_signal(self.account, title="Loose tea", kind="manual", url="")
        base = {"account": self.account.pk}
        for extra in ({"unassigned": "true"}, {"topic": topic.pk}, {"q": "COFFEE"},
                      {"kind": "manual"}, {"id": linked.pk}):
            with self.subTest(**extra):
                self.assertEqual(self.client.get(self.url, {**base, **extra}).json()["count"], 1)
        row = self.client.get(self.url, {**base, "topic": topic.pk}).json()["results"][0]
        self.assertEqual(row["topic_ids"], [topic.pk])
        self.assertNotIn("raw", row)


class TopicAPITests(APITestCase):
    url = "/api/v1/research/topics/"

    def test_manual_create(self):
        s1, s2 = make_signal(self.account), make_signal(self.account)
        r = self.client.post(self.url, {"account": self.account.pk,
                                        "title": "راهنمای خرید آسیاب دستی",
                                        "hooks": ["قبل از خرید آسیاب، این سه چیز را بدان"],
                                        "suggested_formats": ["reel"],
                                        "signal_ids": [s1.pk, s2.pk]}, format="json")
        self.assertEqual(r.status_code, 201, r.json())
        body = r.json()
        self.assertEqual((body["origin"], body["status"], body["run"]),
                         ("manual", "shortlisted", None))
        self.assertEqual(body["signal_count"], 2)
        self.assertGreater(body["evidence_score"], 0)
        self.assertEqual(body["title"], "راهنمای خرید آسیاب دستی")
        dup = self.client.post(self.url, {"account": self.account.pk,
                                          "title": "راهنمای  خرید آسیاب دستی"}, format="json")
        self.assertEqual(fields(dup), {("title", "unique")})

    def test_manual_create_validation(self):
        foreign = make_signal(make_account(handle="other"))
        r = self.client.post(self.url, {"account": self.account.pk, "title": "Fine title",
                                        "hooks": ["a", "b", "x" * 161],
                                        "suggested_formats": ["carousel"],
                                        "signal_ids": [foreign.pk]}, format="json")
        self.assertEqual(fields(r), {("hooks.2", "max_length"),
                                     ("suggested_formats.0", "invalid_choice"),
                                     ("signal_ids.0", "does_not_exist")})
        r = self.client.post(self.url, {"title": "No account"}, format="json")
        self.assertEqual(fields(r), {("account", "required")})

    def test_list_filters_and_order(self):
        for title, score, status in (("A", 40, "new"), ("B", 90, "shortlisted"),
                                     ("C", 99, "dismissed"), ("D", 95, "used")):
            TrendTopic.objects.create(account=self.account, title=title, evidence_score=score,
                                      status=status, keywords=["pour over"])
        r = self.client.get(self.url, {"account": self.account.pk, "status": "new,shortlisted"})
        self.assertEqual([t["title"] for t in r.json()["results"]], ["B", "A"])
        r = self.client.get(self.url, {"account": self.account.pk, "min_evidence": 101})
        self.assertEqual(fields(r), {("min_evidence", "max_value")})
        r = self.client.get(self.url, {"account": self.account.pk, "q": "B"})
        self.assertEqual(r.json()["count"], 1)
        TrendTopic.objects.filter(title="A").update(title="قهوه دمی در خانه")
        r = self.client.get(self.url, {"account": self.account.pk, "q": "دمی"})
        self.assertEqual([t["title"] for t in r.json()["results"]], ["قهوه دمی در خانه"])
        r = self.client.get(self.url, {"account": self.account.pk, "q": "POUR"})
        self.assertEqual(r.json()["count"], 4)  # keywords are searched too
        r = self.client.get(self.url, {"account": self.account.pk, "plan": "none"})
        self.assertEqual(r.json()["count"], 4)

    def test_transitions(self):
        allowed = {("new", "shortlisted"), ("new", "dismissed"), ("shortlisted", "new"),
                   ("shortlisted", "dismissed"), ("dismissed", "new")}
        statuses = ("new", "shortlisted", "dismissed", "used")
        for start in statuses:
            for target in statuses:
                if start == target:
                    continue
                topic = TrendTopic.objects.create(account=self.account, title=f"{start}>{target}",
                                                  status=start)
                r = self.client.patch(f"{self.url}{topic.pk}/", {"status": target},
                                      format="json")
                with self.subTest(start=start, target=target):
                    if (start, target) in allowed:
                        self.assertEqual(r.status_code, 200)
                        self.assertEqual(r.json()["status"], target)
                    else:
                        self.assertEqual(r.status_code, 409)
                        self.assertEqual(r.json()["error"]["details"]["status"], start)

    def test_content_edit_shortlists_and_rescores(self):
        s1, s2, s3 = (make_signal(self.account) for _ in range(3))
        topic = TrendTopic.objects.create(account=self.account, title="Old title")
        topic.signals.set([s1, s2])
        r = self.client.patch(f"{self.url}{topic.pk}/", {"title": "New title",
                                                         "signal_ids": [s1.pk, s2.pk, s3.pk],
                                                         "origin": "manual",
                                                         "evidence_score": 3}, format="json")
        self.assertEqual(r.status_code, 200, r.json())
        body = r.json()
        self.assertEqual((body["status"], body["origin"], body["signal_count"]),
                         ("shortlisted", "ai", 3))
        self.assertEqual(len(body["signals"]), 3)
        self.assertEqual(body["evidence_breakdown"]["signal_count"], 63)

    def test_edit_on_dismissed_keeps_status(self):
        topic = TrendTopic.objects.create(account=self.account, title="T", status="dismissed")
        r = self.client.patch(f"{self.url}{topic.pk}/", {"summary": "x"}, format="json")
        self.assertEqual(r.json()["status"], "dismissed")

    def test_used_is_read_only(self):
        topic = TrendTopic.objects.create(account=self.account, title="T", status="used")
        r = self.client.patch(f"{self.url}{topic.pk}/", {"summary": "x"}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["error"]["details"]["allowed_statuses"], [])

    def test_patch_errors(self):
        topic = TrendTopic.objects.create(account=self.account, title="T")
        TrendTopic.objects.create(account=self.account, title="Taken")
        r = self.client.patch(f"{self.url}{topic.pk}/", {"title": ""}, format="json")
        self.assertEqual(fields(r), {("title", "blank")})
        r = self.client.patch(f"{self.url}{topic.pk}/", {"title": "taken"}, format="json")
        self.assertEqual(fields(r), {("title", "unique")})
        signals = [make_signal(self.account) for _ in range(21)]
        r = self.client.patch(f"{self.url}{topic.pk}/", {"signal_ids": [s.pk for s in signals]},
                              format="json")
        self.assertEqual(fields(r), {("signal_ids", "max_length")})
        self.assertEqual(self.client.get(f"{self.url}999999/").status_code, 404)


class EndToEndRunTests(APITestCase):
    """POST /research/runs/, then run the job with the fake AI provider and a stubbed feed."""

    FEED = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
      <item><title>Entry one</title><link>https://feed.example/one?utm_source=rss</link>
        <description>Cafes report more filter coffee.</description></item>
      <item><title>Entry two</title><link>https://feed.example/two/</link>
        <description>Pour-over gear sales rise.</description></item>
    </channel></rss>"""

    def run_once(self):
        from apps.core.http import FetchResult
        from apps.research.tasks import run_research

        r = self.client.post("/api/v1/research/runs/", {"account": self.account.pk},
                             format="json")
        self.assertEqual(r.status_code, 202, r.json())
        job_id = r.json()["job"]["id"]
        fetch = mock.patch("apps.research.collectors.rss.safe_fetch",
                           return_value=FetchResult(url="https://feed.example/rss",
                                                    status_code=200, content=self.FEED))
        with fetch:
            run_research.apply(args=[job_id])
        return JobRun.objects.get(pk=job_id)

    def test_full_flow_and_dedupe(self):
        make_source(self.account, kind="web_search", value="specialty coffee trends")
        make_source(self.account, kind="web_search", value="pour over at home")
        make_source(self.account, value="https://feed.example/rss")
        job = self.run_once()
        self.assertEqual(job.status, "succeeded", (job.error_code, job.error_detail))
        run = ResearchRun.objects.get()
        self.assertEqual(run.status, "completed")
        self.assertEqual(job.result["run_id"], run.pk)
        self.assertGreater(run.stats["signals"], 2)
        self.assertEqual({v["status"] for v in run.stats["by_source"].values()}, {"ok"})
        self.assertGreaterEqual(TrendTopic.objects.filter(origin="ai").count(), 1)
        self.assertEqual(run.stats["dropped_topics"], 2)

        second = self.run_once()
        self.assertEqual(second.status, "succeeded")
        run2 = ResearchRun.objects.order_by("-pk").first()
        self.assertEqual(run2.stats["signals"], 0)
        self.assertGreater(run2.stats["duplicates"], 0)
        self.assertEqual(ResearchSource.objects.filter(last_status="empty").count(), 3)
        self.assertEqual(TrendSignal.objects.count(), run.stats["signals"])
