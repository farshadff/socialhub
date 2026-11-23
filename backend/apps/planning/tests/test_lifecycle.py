"""E01-S03: activate, close (manual and automatic), duplicate, signals."""

from datetime import UTC, date, datetime

from apps.planning import services
from apps.planning.models import PlanSlot, WeeklyPlan
from apps.planning.signals import plan_activated, plan_closed

from .base import PlanningTestCase


class SignalRecorder:
    def __init__(self, signal):
        self.calls = []
        self.signal = signal
        signal.connect(self.receive, weak=False)

    def receive(self, sender, **kwargs):
        self.calls.append(kwargs)

    def disconnect(self):
        self.signal.disconnect(self.receive)


class LifecycleTestCase(PlanningTestCase):
    def setUp(self):
        super().setUp()
        self.add_template((5, "19:00", "reel"), (0, "12:30", "feed_post"))
        self.plan = self.create_plan().json()
        self.url = f"/api/v1/plans/{self.plan['id']}/"

    def record(self, signal):
        recorder = SignalRecorder(signal)
        self.addCleanup(recorder.disconnect)
        return recorder

    def activate(self):
        return self.client.post(self.url + "activate/", {}, format="json")


class ActivateTests(LifecycleTestCase):
    def test_activates_ready_plan_once(self):  # AC1
        recorder = self.record(plan_activated)
        self.make_ready(self.plan["id"])
        with self.captureOnCommitCallbacks(execute=True):
            response = self.activate()
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["status"], "active")
        self.assertIsNotNone(response.json()["activated_at"])
        self.assertEqual(len(recorder.calls), 1)
        self.assertEqual(self.activate().status_code, 409)  # no longer a draft

    def test_not_ready(self):  # AC2
        PlanSlot.objects.filter(plan_id=self.plan["id"]).delete()
        self.make_ready(self.plan["id"])
        response = self.activate()
        self.assertEqual(response.status_code, 409)
        details = self.error(response)["details"]
        self.assertEqual(details["status"], "draft")
        self.assertEqual(details["problems"], [{"code": "no_slots"}])
        self.assertEqual(WeeklyPlan.objects.get(pk=self.plan["id"]).status, "draft")


class CloseTests(LifecycleTestCase):
    def setUp(self):
        super().setUp()
        self.make_ready(self.plan["id"])
        self.activate()

    def close(self, **body):
        return self.client.post(self.url + "close/", body, format="json")

    def test_week_not_ended_needs_force(self):  # AC3
        response = self.close()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.error(response)["details"],
                         {"status": "active", "reason": "week_not_ended", "week_end": "2026-12-04"})
        recorder = self.record(plan_closed)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.close(force=True)
        self.assertEqual(response.json()["plan"]["status"], "closed")
        self.assertEqual(recorder.calls[0]["forced"], True)
        self.assertEqual(recorder.calls[0]["automatic"], False)

    def test_skips_open_slots_only(self):  # AC4, AC5
        slots = list(PlanSlot.objects.filter(plan_id=self.plan["id"]))
        PlanSlot.objects.filter(pk=slots[0].pk).update(status="reserved")
        result = self.close(force=True).json()
        self.assertEqual((result["slots_skipped"], result["unfinished_items"]), (1, 0))
        self.assertEqual(PlanSlot.objects.get(pk=slots[0].pk).status, "reserved")

    def test_close_requires_active(self):
        self.close(force=True)
        self.assertEqual(self.close(force=True).status_code, 409)

    def test_failing_receiver_does_not_roll_back(self):
        def boom(sender, **kwargs):
            raise RuntimeError("report job failed")

        plan_closed.connect(boom, weak=False)
        self.addCleanup(plan_closed.disconnect, boom)
        with self.assertLogs("apps.planning", "ERROR"), self.captureOnCommitCallbacks(execute=True):
            response = self.close(force=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(WeeklyPlan.objects.get(pk=self.plan["id"]).status, "closed")

    def test_daily_task(self):  # AC6, AC7
        recorder = self.record(plan_closed)
        # Week ends Fri 4 Dec. Sat 5 Dec (yesterday ended): stays active.
        self.now = datetime(2026, 12, 5, 12, 0, tzinfo=UTC)
        self.assertEqual(services.close_finished_plans()["closed"], 0)
        # Mon 7 Dec, three days later: closes, automatically.
        self.now = datetime(2026, 12, 7, 12, 0, tzinfo=UTC)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(services.close_finished_plans()["closed"], 1)
        self.assertEqual(recorder.calls[0]["automatic"], True)
        self.assertEqual(recorder.calls[0]["forced"], False)
        self.assertEqual(services.close_finished_plans(), {"closed": 0, "failed": 0})


class DuplicateTests(LifecycleTestCase):
    def test_copies_goals_and_open_slots(self):  # AC8
        self.make_ready(self.plan["id"], metrics=("reach", "saves", "shares"))
        self.client.patch(self.url, {"notes": "Keep me here"}, format="json")
        slots = list(PlanSlot.objects.filter(plan_id=self.plan["id"]).order_by("scheduled_at"))
        PlanSlot.objects.filter(pk=slots[0].pk).update(status="skipped")
        PlanSlot.objects.filter(pk=slots[1].pk).update(status="reserved")
        response = self.client.post(self.url + "duplicate/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.json())
        copy = response.json()
        self.assertEqual((copy["status"], copy["week_start"], copy["title"]),
                         ("draft", "2026-12-05", "Week of 5 Dec"))
        self.assertEqual(len(copy["goals"]), 3)
        self.assertEqual(copy["notes"], "")
        new_slots = self.client.get(f"/api/v1/plans/{copy['id']}/slots/").json()["results"]
        self.assertEqual([(s["status"], s["local_time"]) for s in new_slots], [("open", "12:30")])
        self.assertEqual(new_slots[0]["local_date"], "2026-12-07")

    def test_target_week_taken(self):  # AC9
        self.create_plan("2026-12-05")
        response = self.client.post(self.url + "duplicate/", {"week_start": "2026-12-05"},
                                    format="json")
        self.assertIn(("week_start", "unique"), self.field_codes(response))

    def test_keeps_local_time_across_daylight_saving(self):
        account = self.utc_account
        account.timezone = "Europe/Berlin"
        account.save()
        self.now = datetime(2027, 3, 18, tzinfo=UTC)
        source = WeeklyPlan.objects.create(account=account, week_start=date(2027, 3, 22))
        PlanSlot.objects.create(plan=source, scheduled_at=datetime(2027, 3, 22, 18, 0, tzinfo=UTC),
                                format="reel")  # 19:00 CET
        copy = services.duplicate(source, copy_slots=True)
        self.assertEqual(copy.slots.get().scheduled_at,
                         datetime(2027, 3, 29, 17, 0, tzinfo=UTC))  # 19:00 CEST
