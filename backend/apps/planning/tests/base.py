from datetime import UTC, datetime
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import InstagramAccount
from apps.planning.models import SlotTemplate

# Monday 23 Nov 2026, 08:00 UTC = 11:30 in Tehran. Tehran weeks start Saturday 21 Nov.
NOW = datetime(2026, 11, 23, 8, 0, tzinfo=UTC)


class PlanningTestCase(TestCase):
    now = NOW

    def setUp(self):
        patcher = mock.patch("apps.planning.clock.now", side_effect=lambda: self.now)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.user = get_user_model().objects.create_user("sara", password="pw", first_name="Sara")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.account = InstagramAccount.objects.create(
            handle="greenhome", display_name="Green Home", timezone="Asia/Tehran",
            week_start_day=5)
        self.account.brand.audience_summary = "Homeowners in Tehran"
        self.account.brand.save()
        self.utc_account = InstagramAccount.objects.create(
            handle="utcshop", display_name="UTC Shop", timezone="UTC", week_start_day=0)

    # helpers
    def create_plan(self, week_start="2026-11-28", account=None, **extra):
        body = {"account": (account or self.account).id, "week_start": week_start, **extra}
        return self.client.post("/api/v1/plans/", body, format="json")

    def add_template(self, *rows, account=None):
        for weekday, local_time, fmt, *rest in rows:
            SlotTemplate.objects.create(account=account or self.account, weekday=weekday,
                                        local_time=local_time, format=fmt,
                                        default_role=rest[0] if rest else None)

    def make_ready(self, plan_id, metrics=("reach",)):
        response = self.client.patch(f"/api/v1/plans/{plan_id}/", {
            "objective": "Launch", "success_metrics": list(metrics),
            "goals": [{"metric": m, "scope": "week_total", "format": None, "target_value": 100}
                      for m in metrics],
        }, format="json")
        assert response.status_code == 200, response.json()
        return response.json()

    def error(self, response):
        return response.json()["error"]

    def field_codes(self, response):
        return {(f["path"], f["code"]) for f in self.error(response)["fields"]}
