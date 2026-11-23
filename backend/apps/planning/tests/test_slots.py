"""E01-S02: slot template, generation, slot edits and posting rules."""

from datetime import UTC, datetime, time

from apps.planning import services
from apps.planning.models import PlanSlot, SlotTemplate, WeeklyPlan

from .base import PlanningTestCase


class TemplateTests(PlanningTestCase):
    def url(self):
        return f"/api/v1/accounts/{self.account.id}/slot-template/"

    def put(self, rows):
        return self.client.put(self.url(), {"rows": rows}, format="json")

    def test_empty_and_replace(self):
        self.assertEqual(self.client.get(self.url()).json(),
                         {"account": self.account.id, "timezone": "Asia/Tehran", "rows": []})
        rows = [{"weekday": 5, "local_time": "19:00", "format": "reel",
                 "default_role": "attract", "active": True}]
        response = self.put(rows)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["rows"][0]["local_time"], "19:00")
        self.put([{"weekday": 0, "local_time": "12:30", "format": "story"}])
        self.assertEqual(SlotTemplate.objects.filter(account=self.account).count(), 1)

    def test_daily_limit(self):  # AC2
        rows = [{"weekday": 2, "local_time": t, "format": "reel"}
                for t in ("08:00", "12:00", "18:00")]
        self.assertIn(("rows.2.format", "exceeds_daily_limit"), self.field_codes(self.put(rows)))
        # Inactive rows do not count.
        rows[2]["active"] = False
        self.assertEqual(self.put(rows).status_code, 200)

    def test_gap(self):  # AC3
        rows = [{"weekday": 2, "local_time": "12:00", "format": "reel"},
                {"weekday": 2, "local_time": "13:00", "format": "feed_post"}]
        self.assertIn(("rows.1.local_time", "gap_too_small"), self.field_codes(self.put(rows)))
        # Stories are exempt from the gap rule.
        rows[1]["format"] = "story"
        self.assertEqual(self.put(rows).status_code, 200)

    def test_row_validation(self):
        dup = {"weekday": 1, "local_time": "10:00", "format": "story"}
        self.assertIn(("rows.1.local_time", "unique"), self.field_codes(self.put([dup, dup])))
        step = {"weekday": 1, "local_time": "10:03", "format": "story"}
        self.assertIn(("rows.0.local_time", "invalid_step"), self.field_codes(self.put([step])))
        self.assertIn(("rows", "max_length"),
                      self.field_codes(self.put([{**step, "local_time": "10:00"}] * 41)))


class GenerateTests(PlanningTestCase):
    def setUp(self):
        super().setUp()
        self.add_template((5, "19:00", "reel", "attract"), (5, "10:00", "story", "engage"),
                          (0, "12:30", "feed_post"))
        self.plan = self.create_plan(generate_slots=False).json()
        self.url = f"/api/v1/plans/{self.plan['id']}/slots/generate/"

    def test_timezone_conversion(self):  # AC1
        result = self.client.post(self.url, {}, format="json").json()
        self.assertEqual(result["created"], 3)
        reel = next(s for s in result["slots"] if s["format"] == "reel")
        self.assertEqual(reel["scheduled_at"], "2026-11-28T15:30:00Z")
        self.assertEqual((reel["local_date"], reel["local_time"], reel["weekday"]),
                         ("2026-11-28", "19:00", 5))
        self.assertEqual(reel["role"], "attract")

    def test_no_duplicates(self):  # AC4
        self.client.post(self.url, {}, format="json")
        result = self.client.post(self.url, {}, format="json").json()
        self.assertEqual((result["created"], result["skipped"]), (0, 3))

    def test_replace_keeps_reserved(self):  # AC5
        slots = self.client.post(self.url, {}, format="json").json()["slots"]
        PlanSlot.objects.filter(pk=slots[0]["id"]).update(status="reserved")
        result = self.client.post(self.url, {"replace": True}, format="json").json()
        self.assertEqual((result["deleted"], result["created"], result["skipped"]), (2, 2, 1))
        self.assertTrue(PlanSlot.objects.filter(pk=slots[0]["id"], status="reserved").exists())

    def test_skips_times_too_soon(self):
        self.now = datetime(2026, 11, 28, 15, 10, tzinfo=UTC)  # 20 minutes before the reel
        result = self.client.post(self.url, {}, format="json").json()
        self.assertEqual(result["created"], 1)  # only the Monday feed post

    def test_errors(self):
        SlotTemplate.objects.all().delete()
        self.assertIn(("non_field_errors", "no_template"),
                      self.field_codes(self.client.post(self.url, {}, format="json")))
        WeeklyPlan.objects.filter(pk=self.plan["id"]).update(status="closed")
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 409)

    def test_daylight_saving_zone(self):
        # Europe/Berlin moves to summer time on Sunday 28 Mar 2027.
        self.utc_account.timezone = "Europe/Berlin"
        self.utc_account.save()
        self.now = datetime(2027, 3, 20, tzinfo=UTC)
        plan = WeeklyPlan.objects.create(account=self.utc_account, week_start=datetime(2027, 3, 22).date())
        for weekday in (5, 0):  # Saturday 27 Mar (CET) and Monday 29 Mar (CEST)
            SlotTemplate.objects.create(account=self.utc_account, weekday=weekday,
                                        local_time=time(19, 0), format="reel")
        services.generate_slots(plan)
        times = sorted(s.scheduled_at for s in plan.slots.all())
        self.assertEqual(times, [datetime(2027, 3, 22, 18, 0, tzinfo=UTC),
                                 datetime(2027, 3, 27, 18, 0, tzinfo=UTC)])
        plan2 = WeeklyPlan.objects.create(account=self.utc_account, week_start=datetime(2027, 3, 29).date())
        services.generate_slots(plan2)
        self.assertEqual(min(s.scheduled_at for s in plan2.slots.all()),
                         datetime(2027, 3, 29, 17, 0, tzinfo=UTC))


class SlotEditTests(PlanningTestCase):
    def setUp(self):
        super().setUp()
        self.plan = self.create_plan(generate_slots=False).json()
        self.slots_url = f"/api/v1/plans/{self.plan['id']}/slots/"

    def add(self, **body):
        return self.client.post(self.slots_url, body, format="json")

    def test_create_with_local_time_and_list(self):
        response = self.add(local_date="2026-11-30", local_time="12:30", format="feed_post",
                            role="educate")
        self.assertEqual(response.status_code, 201, response.json())
        self.assertEqual(response.json()["scheduled_at"], "2026-11-30T09:00:00Z")
        listing = self.client.get(self.slots_url).json()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(self.client.get(self.slots_url + "?format=reel").json()["count"], 0)

    def test_create_errors(self):
        self.assertIn(("scheduled_at", "outside_week"),
                      self.field_codes(self.add(scheduled_at="2026-12-10T09:00:00Z", format="reel")))
        self.now = datetime(2026, 11, 28, 8, 50, tzinfo=UTC)
        self.assertIn(("scheduled_at", "too_soon"),  # AC6: 10 minutes ahead
                      self.field_codes(self.add(scheduled_at="2026-11-28T09:00:00Z", format="reel")))
        self.now = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)
        self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel")
        self.assertIn(("scheduled_at", "unique"),
                      self.field_codes(self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel")))
        self.assertIn(("scheduled_at", "gap_too_small"),
                      self.field_codes(self.add(scheduled_at="2026-11-30T10:00:00Z", format="feed_post")))
        self.add(scheduled_at="2026-11-30T13:00:00Z", format="reel")
        self.assertIn(("scheduled_at", "exceeds_daily_limit"),
                      self.field_codes(self.add(scheduled_at="2026-11-30T17:00:00Z", format="reel")))

    def test_max_slots(self):  # AC10
        plan = WeeklyPlan.objects.get(pk=self.plan["id"])
        PlanSlot.objects.bulk_create(
            PlanSlot(plan=plan, scheduled_at=datetime(2026, 12, 1, 0, i, tzinfo=UTC), format="story",
                     status="skipped") for i in range(60))
        self.assertIn(("non_field_errors", "max_slots"),
                      self.field_codes(self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel")))

    def test_reserved_slot_rules(self):  # AC7
        slot = self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel").json()
        PlanSlot.objects.filter(pk=slot["id"]).update(status="reserved")
        url = f"/api/v1/slots/{slot['id']}/"
        response = self.client.patch(url, {"scheduled_at": "2026-12-01T09:00:00Z"}, format="json")
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["status"], "reserved")
        response = self.client.patch(url, {"format": "story"}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.error(response)["details"], {"status": "reserved", "fields": ["format"]})
        # Sending the unchanged format alongside other edits is fine.
        self.assertEqual(self.client.patch(url, {"format": "reel", "note": "n"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 409)

    def test_scheduled_slot_time_locked(self):  # AC8
        slot = self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel").json()
        PlanSlot.objects.filter(pk=slot["id"]).update(status="scheduled")
        url = f"/api/v1/slots/{slot['id']}/"
        self.assertEqual(self.client.patch(url, {"scheduled_at": "2026-12-01T09:00:00Z"},
                                           format="json").status_code, 409)
        self.assertEqual(self.client.patch(url, {"note": "ok"}, format="json").status_code, 200)

    def test_skip_frees_limit_and_readiness(self):  # AC9
        first = self.add(scheduled_at="2026-11-30T05:00:00Z", format="reel").json()
        self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel")
        url = f"/api/v1/slots/{first['id']}/"
        self.assertEqual(self.client.patch(url, {"status": "skipped"}, format="json").json()["status"],
                         "skipped")
        self.assertEqual(self.add(scheduled_at="2026-11-30T13:00:00Z", format="reel").status_code, 201)
        # Restoring would now break the daily limit.
        self.assertIn(("scheduled_at", "exceeds_daily_limit"),
                      self.field_codes(self.client.patch(url, {"status": "open"}, format="json")))
        plan = self.client.get(f"/api/v1/plans/{self.plan['id']}/").json()
        self.assertEqual(plan["slot_summary"]["total"], 2)

    def test_closed_plan_read_only_and_delete(self):
        slot = self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel").json()
        url = f"/api/v1/slots/{slot['id']}/"
        self.assertEqual(self.client.delete(url).status_code, 204)
        slot = self.add(scheduled_at="2026-11-30T09:00:00Z", format="reel").json()
        WeeklyPlan.objects.filter(pk=self.plan["id"]).update(status="closed")
        self.assertEqual(self.client.patch(f"/api/v1/slots/{slot['id']}/", {"note": "x"},
                                           format="json").status_code, 409)
        self.assertEqual(self.add(scheduled_at="2026-12-01T09:00:00Z", format="reel").status_code, 409)


class ReserveReleaseTests(PlanningTestCase):
    def test_release_future_and_past(self):
        plan = WeeklyPlan.objects.create(account=self.account, week_start=datetime(2026, 11, 21).date())
        future = PlanSlot.objects.create(plan=plan, scheduled_at=datetime(2026, 11, 25, tzinfo=UTC),
                                         format="reel")
        past = PlanSlot.objects.create(plan=plan, scheduled_at=datetime(2026, 11, 22, tzinfo=UTC),
                                       format="reel", status="reserved")
        services.reserve_slot(future)
        self.assertEqual(future.status, "reserved")
        self.assertEqual(services.release_slot(future).status, "open")
        self.assertEqual(services.release_slot(past).status, "skipped")
