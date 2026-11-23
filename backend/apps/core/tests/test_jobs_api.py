"""E00-S06 `GET /jobs/` and `GET /jobs/{id}/`, plus the `409 job_in_progress` shape."""

from datetime import UTC, datetime
from unittest import mock

import pytest
from django.test import override_settings
from django.urls import include, path
from freezegun import freeze_time
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.accounts.models import InstagramAccount
from apps.core import jobs
from apps.core.models import JobRun
from apps.core.tests.testapp.models import DummyItem

pytestmark = pytest.mark.django_db


@pytest.fixture
def account():
    return InstagramAccount.objects.create(handle="greenhome", display_name="Green Home")


@pytest.fixture
def other_account():
    return InstagramAccount.objects.create(handle="utcshop", display_name="UTC Shop")


def make(account=None, created_by=None, **fields):
    fields.setdefault("kind", "test.echo")
    fields.setdefault("target_type", "test_item")
    fields.setdefault("target_id", "88")
    fields.setdefault("status", "succeeded")
    return JobRun.objects.create(account=account, created_by=created_by, **fields)


def ids(response):
    return [row["id"] for row in response.json()["results"]]


# --- detail ---------------------------------------------------------------------------------


def test_job_detail_shape(operator_api, operator_user, account):
    with freeze_time("2026-11-28 08:02:11"):
        job = make(account, operator_user, kind="production.render", status="running",
                   progress=60, message="Rendering frame 3 of 5", queue="render",
                   request_id="req-1", started_at=datetime(2026, 11, 28, 8, 2, 12, tzinfo=UTC))
    response = operator_api.get(f"/api/v1/jobs/{job.id}/")
    assert response.status_code == 200
    assert response.json() == {
        "id": str(job.id), "kind": "production.render", "status": "running", "progress": 60,
        "message": "Rendering frame 3 of 5", "account": account.id, "queue": "render",
        "target_type": "test_item", "target_id": "88", "result": None, "error_code": None,
        "error_detail": None, "created_by": {"id": operator_user.id, "name": "Sara Moradi"},
        "request_id": "req-1", "created_at": "2026-11-28T08:02:11Z",
        "started_at": "2026-11-28T08:02:12Z", "finished_at": None,
    }


def test_system_job_visibility(operator_api, admin_api, admin_user, operator_user):
    admins = make(None, admin_user, kind="system.ai_test", target_type="system", target_id="ai")
    own = make(None, operator_user, kind="system.ai_test", target_type="system",
               target_id="ai2")
    scheduled = make(None, None, kind="test.prunable", target_type="system", target_id="x")

    response = operator_api.get(f"/api/v1/jobs/{admins.id}/")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert operator_api.get(f"/api/v1/jobs/{scheduled.id}/").status_code == 404
    assert operator_api.get(f"/api/v1/jobs/{own.id}/").status_code == 200
    assert admin_api.get(f"/api/v1/jobs/{admins.id}/").status_code == 200
    assert admin_api.get(f"/api/v1/jobs/{scheduled.id}/").status_code == 200


@pytest.mark.parametrize("job_id", ["not-a-uuid", "5d1a2f7e-3b8c-4c41-9e0a-7a2d6c1f4b90"])
def test_unknown_or_malformed_id_is_404(operator_api, job_id):
    response = operator_api.get(f"/api/v1/jobs/{job_id}/")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --- list -----------------------------------------------------------------------------------


def test_operator_must_pass_account(operator_api):
    response = operator_api.get("/api/v1/jobs/")
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert [(f["path"], f["code"]) for f in error["fields"]] == [("account", "required")]


def test_admin_lists_across_accounts_and_system_jobs(admin_api, admin_user, account,
                                                     other_account):
    a = make(account)
    b = make(other_account, target_id="89")
    system = make(None, admin_user, kind="system.ai_test", target_type="system", target_id="ai")
    response = admin_api.get("/api/v1/jobs/")
    assert response.status_code == 200
    assert set(ids(response)) == {str(a.id), str(b.id), str(system.id)}
    assert set(response.json()) == {"count", "next", "previous", "results"}
    assert ids(admin_api.get("/api/v1/jobs/?account=none")) == [str(system.id)]
    assert ids(admin_api.get(f"/api/v1/jobs/?account={account.id}")) == [str(a.id)]


def test_operator_lists_one_account(operator_api, account, other_account):
    a = make(account)
    make(other_account, target_id="89")
    response = operator_api.get(f"/api/v1/jobs/?account={account.id}")
    assert ids(response) == [str(a.id)]


def test_operator_account_none_shows_only_own_system_jobs(operator_api, operator_user,
                                                          admin_user):
    own = make(None, operator_user, kind="system.ai_test", target_type="system", target_id="a")
    make(None, admin_user, kind="system.ai_test", target_type="system", target_id="b")
    assert ids(operator_api.get("/api/v1/jobs/?account=none")) == [str(own.id)]


def test_filters_and_ordering(operator_api, account):
    with freeze_time("2026-11-28 08:00:00"):
        render = make(account, kind="production.render", status="running", target_id="88")
    with freeze_time("2026-11-28 09:00:00"):
        start = make(account, kind="production.start", status="queued", target_id="93")
    with freeze_time("2026-11-28 10:00:00"):
        qc = make(account, kind="qc.run", status="failed", target_id="91",
                  target_type="content_item")

    base = f"/api/v1/jobs/?account={account.id}"
    assert ids(operator_api.get(base)) == [str(qc.id), str(start.id), str(render.id)]
    assert ids(operator_api.get(base + "&ordering=created_at")) == [
        str(render.id), str(start.id), str(qc.id)]
    assert ids(operator_api.get(base + "&status=queued,running&kind_prefix=production.")) == [
        str(start.id), str(render.id)]
    assert ids(operator_api.get(base + "&kind=qc.run,production.start")) == [
        str(qc.id), str(start.id)]
    assert ids(operator_api.get(base + "&target_type=content_item&target_id=91")) == [
        str(qc.id)]
    assert ids(operator_api.get(
        base + "&created_after=2026-11-28T08:30:00Z&created_before=2026-11-28T09:30:00Z")) == [
        str(start.id)]
    assert operator_api.get(base + "&page_size=1").json()["count"] == 3


@pytest.mark.parametrize("query,field,code", [
    ("status=done", "status", "invalid_choice"),
    ("created_after=yesterday", "created_after", "invalid"),
    ("created_before=2026-13-45T00:00:00Z", "created_before", "invalid"),
    ("ordering=kind", "ordering", "invalid_choice"),
    ("account=abc", "account", "invalid"),
])
def test_bad_filters(operator_api, account, query, field, code):
    response = operator_api.get(f"/api/v1/jobs/?account={account.id}&{query}"
                                if not query.startswith("account") else f"/api/v1/jobs/?{query}")
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert (field, code) in {(f["path"], f["code"]) for f in error["fields"]}


# --- 409 job_in_progress --------------------------------------------------------------------


@api_view(["POST"])
def start_echo(request):
    job = jobs.start_job("test.echo", target_id=88, user=request.user,
                         request_id=request.request_id)
    return Response({"job": jobs.job_payload(job)}, status=202)


urlpatterns = [
    path("api/v1/", include("config.urls")),
    path("api/v1/test/start-echo/", start_echo),
]


@override_settings(ROOT_URLCONF=__name__)
def test_job_in_progress_response(operator_api, operator_user):
    DummyItem.objects.create(pk=88)
    with mock.patch.object(jobs, "_enqueue"):
        first = operator_api.post("/api/v1/test/start-echo/")
        assert first.status_code == 202
        job = first.json()["job"]
        assert job["status"] == "queued" and job["request_id"]
        second = operator_api.post("/api/v1/test/start-echo/")
    assert second.status_code == 409
    error = second.json()["error"]
    assert error["code"] == "job_in_progress"
    assert error["retryable"] is True
    assert error["fields"] == []
    assert error["details"]["job"] == job
    assert list(error) == ["code", "message", "fields", "details", "request_id", "retryable"]
