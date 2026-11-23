"""E01-S01 acceptance criteria and validation rules."""

from apps.planning.models import PlanGoal, WeeklyPlan

from .base import PlanningTestCase


class CreatePlanTests(PlanningTestCase):
    def test_creates_draft_with_week_end_and_defaults(self):  # AC1
        response = self.create_plan()
        self.assertEqual(response.status_code, 201, response.json())
        plan = response.json()
        self.assertEqual(plan["status"], "draft")
        self.assertEqual(plan["week_end"], "2026-12-04")
        self.assertEqual(plan["title"], "Week of 28 Nov")
        self.assertEqual(plan["audience_summary"], "Homeowners in Tehran")
        self.assertEqual(plan["success_metrics"], ["reach", "saves", "shares"])
        self.assertEqual(plan["created_by"], {"id": self.user.id, "name": "Sara"})

    def test_rejects_week_start_on_wrong_day(self):  # AC2
        response = self.create_plan("2026-11-30")
        self.assertEqual(response.status_code, 400)
        self.assertIn(("week_start", "invalid_week_start"), self.field_codes(response))

    def test_rejects_second_plan_for_same_week(self):  # AC3
        self.create_plan()
        response = self.create_plan()
        self.assertIn(("week_start", "unique"), self.field_codes(response))

    def test_week_range(self):
        self.assertEqual(self.create_plan("2026-11-21").status_code, 201)  # current week
        self.assertEqual(self.create_plan("2027-01-16").status_code, 201)  # eight weeks ahead
        for too_far_or_past in ("2027-01-23", "2026-11-14"):
            response = self.create_plan(too_far_or_past)
            self.assertIn(("week_start", "out_of_range"), self.field_codes(response))

    def test_week_ended_locally_but_not_in_utc(self):
        # Fri 20 Nov 2026 21:00 UTC is Sat 00:30 in Tehran: the Tehran week of 14 Nov has
        # ended locally although Friday is not over in UTC, so that week is out of range and
        # the week of 21 Nov is the current one.
        self.now = self.now.replace(day=20, hour=21)
        response = self.create_plan("2026-11-14")
        self.assertIn(("week_start", "out_of_range"), self.field_codes(response))
        self.assertEqual(self.create_plan("2026-11-21").status_code, 201)

    def test_archived_account(self):
        self.account.status = "archived"
        self.account.save()
        self.assertIn(("account", "account_archived"), self.field_codes(self.create_plan()))

    def test_generates_slots_from_template(self):
        self.add_template((5, "19:00", "reel", "attract"), (0, "12:30", "feed_post"))
        plan = self.create_plan().json()
        self.assertEqual(plan["slot_summary"]["total"], 2)
        plan = self.create_plan("2026-12-05", generate_slots=False).json()
        self.assertEqual(plan["slot_summary"]["total"], 0)

    def test_requires_sign_in(self):
        self.client.force_authenticate(None)
        response = self.client.get(f"/api/v1/plans/?account={self.account.id}")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.error(response)["code"], "authentication_required")


class ListPlanTests(PlanningTestCase):
    def test_list_requires_account_and_omits_long_fields(self):
        self.assertEqual(self.client.get("/api/v1/plans/").status_code, 400)
        self.create_plan()
        self.create_plan("2026-12-05")
        response = self.client.get(f"/api/v1/plans/?account={self.account.id}")
        rows = response.json()["results"]
        self.assertEqual([row["week_start"] for row in rows], ["2026-12-05", "2026-11-28"])
        self.assertNotIn("objective", rows[0])
        self.assertIn("readiness", rows[0])

    def test_filters(self):
        first = self.create_plan().json()
        self.create_plan("2026-12-05")
        WeeklyPlan.objects.filter(pk=first["id"]).update(status="active")
        url = f"/api/v1/plans/?account={self.account.id}"
        self.assertEqual(self.client.get(url + "&status=active").json()["count"], 1)
        self.assertEqual(self.client.get(url + "&week_start_after=2026-12-01").json()["count"], 1)
        rows = self.client.get(url + "&ordering=week_start").json()["results"]
        self.assertEqual(rows[0]["id"], first["id"])


class UpdatePlanTests(PlanningTestCase):
    def setUp(self):
        super().setUp()
        self.plan = self.create_plan().json()
        self.url = f"/api/v1/plans/{self.plan['id']}/"

    def patch(self, body):
        return self.client.patch(self.url, body, format="json")

    def test_follower_growth_per_post_is_invalid(self):  # AC4
        response = self.patch({"goals": [{"metric": "follower_growth", "scope": "per_post",
                                          "target_value": 10}]})
        self.assertEqual(response.status_code, 400)
        self.assertIn(("goals.0.scope", "invalid_combination"), self.field_codes(response))

    def test_goal_rules(self):
        cases = [
            ({"metric": "replies", "scope": "week_total", "format": "reel", "target_value": 1},
             ("goals.0.format", "invalid_combination")),
            ({"metric": "nope", "scope": "week_total", "target_value": 1},
             ("goals.0.metric", "invalid_choice")),
            ({"metric": "reach", "scope": "week_total", "target_value": 0},
             ("goals.0.target_value", "min_value")),
            ({"metric": "reach", "scope": "week_total", "target_value": 100_000_001},
             ("goals.0.target_value", "max_value")),
        ]
        for goal, expected in cases:
            with self.subTest(goal=goal):
                self.assertIn(expected, self.field_codes(self.patch({"goals": [goal]})))
        dup = {"metric": "reach", "scope": "week_total", "format": None, "target_value": 1}
        self.assertIn(("goals.1.metric", "duplicate"), self.field_codes(self.patch({"goals": [dup, dup]})))
        many = [{"metric": m, "scope": s, "format": f, "target_value": 1}
                for m in ("reach", "views", "likes", "saves") for s in ("week_total", "per_post")
                for f in (None, "reel", "story")]
        self.assertIn(("goals", "max_length"), self.field_codes(self.patch({"goals": many})))

    def test_goals_replace_semantics(self):  # AC5
        goals = self.patch({"goals": [
            {"metric": "reach", "scope": "week_total", "target_value": 100},
            {"metric": "saves", "scope": "week_total", "target_value": 50},
        ]}).json()["goals"]
        a = goals[0]
        response = self.patch({"goals": [{**a, "target_value": 200}]})
        self.assertEqual(response.json()["goals"], [{**a, "target_value": 200}])
        self.assertEqual(PlanGoal.objects.filter(plan_id=self.plan["id"]).count(), 1)
        # Leaving out the goals key keeps them.
        self.assertEqual(len(self.patch({"notes": "x"}).json()["goals"]), 1)

    def test_goal_swap_does_not_collide(self):
        goals = self.patch({"goals": [
            {"metric": "reach", "scope": "week_total", "target_value": 1},
            {"metric": "saves", "scope": "week_total", "target_value": 2},
        ]}).json()["goals"]
        swapped = [{**goals[0], "metric": "saves"}, {**goals[1], "metric": "reach"}]
        response = self.patch({"goals": swapped})
        self.assertEqual(response.status_code, 200, response.json())

    def test_unknown_goal_id(self):
        response = self.patch({"goals": [{"id": 999, "metric": "reach", "scope": "week_total",
                                          "target_value": 1}]})
        self.assertIn(("goals.0.id", "does_not_exist"), self.field_codes(response))

    def test_goal_missing_in_readiness(self):  # AC6
        plan = self.patch({"success_metrics": ["reach", "saves"], "goals": [
            {"metric": "reach", "scope": "week_total", "target_value": 1}]}).json()
        problems = plan["readiness"]["problems"]
        self.assertIn({"code": "goal_missing", "details": {"metrics": ["saves"]}}, problems)
        self.assertFalse(plan["readiness"]["can_activate"])

    def test_field_limits(self):
        cases = [
            ({"title": ""}, ("title", "blank")),
            ({"objective": "x" * 1001}, ("objective", "max_length")),
            ({"success_metrics": []}, ("success_metrics", "min_length")),
            ({"success_metrics": ["reach", "reach"]}, ("success_metrics", "duplicate")),
            ({"audience_segments": [{"name": "A"}, {"name": "a"}]},
             ("audience_segments.1.name", "unique")),
            ({"audience_segments": [{"name": str(i)} for i in range(6)]},
             ("audience_segments", "max_length")),
        ]
        for body, expected in cases:
            with self.subTest(body=body):
                self.assertIn(expected, self.field_codes(self.patch(body)))

    def test_active_plan_editable_but_week_start_read_only(self):  # AC7
        WeeklyPlan.objects.filter(pk=self.plan["id"]).update(status="active")
        self.assertEqual(self.patch({"objective": "New"}).json()["objective"], "New")
        response = self.patch({"week_start": "2026-12-05"})
        self.assertIn(("week_start", "read_only"), self.field_codes(response))

    def test_closed_plan_only_notes(self):  # AC8
        WeeklyPlan.objects.filter(pk=self.plan["id"]).update(status="closed")
        response = self.patch({"objective": "New"})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.error(response)["code"], "invalid_transition")
        self.assertEqual(self.error(response)["details"], {"status": "closed",
                                                           "fields": ["objective"]})
        self.assertEqual(self.patch({"notes": "Done"}).json()["notes"], "Done")

    def test_carried_finding_state(self):  # AC9
        WeeklyPlan.objects.filter(pk=self.plan["id"]).update(carried_findings=[
            {"id": "f2", "report_id": 7, "type": "worked", "title": "T", "detail": "",
             "recommendation": "", "plan_field": "slots", "suggested_change": {},
             "state": "pending"}])
        response = self.patch({"carried_findings_state": [{"id": "f2", "state": "applied"}]})
        self.assertEqual(response.json()["carried_findings"][0]["state"], "applied")
        self.assertEqual(self.client.get(self.url).json()["carried_findings"][0]["state"],
                         "applied")
        response = self.patch({"carried_findings_state": [{"id": "zz", "state": "applied"}]})
        self.assertIn(("carried_findings_state.0.id", "does_not_exist"),
                      self.field_codes(response))

    def test_delete_only_drafts(self):
        WeeklyPlan.objects.filter(pk=self.plan["id"]).update(status="active")
        self.assertEqual(self.client.delete(self.url).status_code, 409)
        WeeklyPlan.objects.filter(pk=self.plan["id"]).update(status="draft")
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertEqual(self.client.get(self.url).status_code, 404)


class CurrentPlanTests(PlanningTestCase):
    def url(self):
        return f"/api/v1/plans/current/?account={self.account.id}"

    def test_none(self):
        self.create_plan()
        self.assertEqual(self.client.get(self.url()).status_code, 404)

    def test_prefers_this_week_then_nearest_future(self):  # AC10
        this_week = self.create_plan("2026-11-21").json()
        next_week = self.create_plan("2026-11-28").json()
        later = self.create_plan("2026-12-05").json()
        WeeklyPlan.objects.filter(pk__in=[next_week["id"], later["id"]]).update(status="active")
        self.assertEqual(self.client.get(self.url()).json()["id"], next_week["id"])
        WeeklyPlan.objects.filter(pk=this_week["id"]).update(status="active")
        self.assertEqual(self.client.get(self.url()).json()["id"], this_week["id"])
