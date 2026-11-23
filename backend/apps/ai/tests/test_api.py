"""System status, AI test job, AI run log, pruning and settings (E00-S05 BE5)."""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from django.conf import settings as django_settings
from django.utils import timezone

from apps.ai.jobs import prune_payloads
from apps.ai.models import AIRun
from apps.core.models import JobRun

pytestmark = pytest.mark.django_db

STATUS = "/api/v1/system/status/"
AI_TEST = "/api/v1/system/ai-test/"
RUNS = "/api/v1/ai/runs/"
BACKEND = Path(__file__).resolve().parents[3]


def _code(response):
    return response.json()["error"]["code"]


# --- permissions (AC13) ----------------------------------------------------------------------


@pytest.mark.parametrize("method, url", [("get", STATUS), ("post", AI_TEST), ("get", RUNS),
                                         ("get", f"{RUNS}1/")])
def test_operator_gets_permission_denied(operator_api, method, url):
    response = getattr(operator_api, method)(url, format="json")
    assert response.status_code == 403 and _code(response) == "permission_denied"


def test_anonymous_gets_authentication_required(api_client):
    response = api_client.get(STATUS)
    assert response.status_code == 403 and _code(response) == "authentication_required"


# --- GET /system/status/ ---------------------------------------------------------------------


def test_status_with_fake_providers(admin_api):
    body = admin_api.get(STATUS).json()
    assert set(body) == {"app", "dependencies", "workers", "ai", "instagram", "storage"}
    assert body["app"] == {"version": "0.1.0", "environment": django_settings.SOCIALHUB_ENVIRONMENT,
                           "debug": django_settings.DEBUG}
    assert body["dependencies"]["database"] == "ok"
    assert body["dependencies"]["redis"] in ("ok", "unavailable")
    assert body["workers"] == {"default": "unknown", "render": "unknown", "publish": "unknown"}
    assert body["ai"]["text"] == {"provider": "fake", "configured": True, "missing": [],
                                  "model": "fake", "overrides": {}}
    assert body["ai"]["image"] == {"provider": "fake", "configured": True, "missing": [],
                                   "model": "fake"}
    assert body["ai"]["models_without_price"] == []
    assert body["ai"]["max_calls_per_job"] == 20 and body["ai"]["timeout_seconds"] == 180
    # E00-S04: connection settings. Missing settings are listed by name only.
    assert body["instagram"]["default_provider"] in ("fake", "manual")
    assert set(body["instagram"]["meta_app"]) >= {"configured", "missing", "app_id", "redirect_uri"}
    assert "app_secret" not in body["instagram"]["meta_app"]
    assert body["storage"]["backend"] == "local"


def test_status_with_real_providers_missing_keys_never_shows_secrets(admin_api, settings):
    settings.SOCIALHUB_AI_TEXT_PROVIDER = "anthropic"
    settings.ANTHROPIC_API_KEY = ""
    settings.SOCIALHUB_AI_IMAGE_PROVIDER = "openai"
    settings.OPENAI_API_KEY = "sk-secret-value"
    settings.SOCIALHUB_AI_IMAGE_MODEL = "gpt-image-unpriced"
    response = admin_api.get(STATUS)
    body = response.json()["ai"]
    assert body["text"] == {"provider": "anthropic", "configured": False,
                            "missing": ["ANTHROPIC_API_KEY"], "model": "claude-opus-5-5",
                            "overrides": {}}
    assert body["image"]["configured"] is True and body["image"]["missing"] == []
    assert body["models_without_price"] == ["gpt-image-unpriced"]
    assert "sk-secret-value" not in response.content.decode()


def test_worker_status_from_inspect(admin_api, settings, monkeypatch):
    settings.CELERY_TASK_ALWAYS_EAGER = False

    class Inspect:
        def active_queues(self):
            return {"w1@host": [{"name": "default"}, {"name": "render"}]}

    from celery import current_app

    monkeypatch.setattr(current_app.control, "inspect", lambda timeout: Inspect())
    assert admin_api.get(STATUS).json()["workers"] == {
        "default": "ok", "render": "ok", "publish": "unavailable"}

    def broken(timeout):
        raise OSError("broker down")

    monkeypatch.setattr(current_app.control, "inspect", broken)
    assert set(admin_api.get(STATUS).json()["workers"].values()) == {"unknown"}


# --- POST /system/ai-test/ -------------------------------------------------------------------


def _run_ai_test(client, captured, body=None):
    with captured(execute=True):
        response = client.post(AI_TEST, body, format="json")
    return response


def test_ai_test_with_fake_providers(admin_api, django_capture_on_commit_callbacks):
    """AC1."""
    response = _run_ai_test(admin_api, django_capture_on_commit_callbacks)
    assert response.status_code == 202
    job = response.json()["job"]
    assert (job["kind"], job["target_type"], job["target_id"]) == ("system.ai_test", "system",
                                                                   "ai")
    finished = admin_api.get(f"/api/v1/jobs/{job['id']}/").json()
    assert finished["status"] == "succeeded" and finished["progress"] == 100
    result = finished["result"]
    for kind in ("text", "image"):
        assert result[kind]["ok"] is True and result[kind]["provider"] == "fake"
        assert result[kind]["error_code"] is None and result[kind]["ai_run_id"]
    runs = AIRun.objects.filter(job_id=job["id"])
    assert runs.count() == 2
    assert set(runs.values_list("provider", flat=True)) == {"fake"}
    assert all(run.cost_usd == 0 for run in runs)


def test_ai_test_reports_missing_key_in_result(admin_api, settings,
                                               django_capture_on_commit_callbacks):
    settings.SOCIALHUB_AI_IMAGE_PROVIDER = "openai"
    settings.OPENAI_API_KEY = ""
    settings.SOCIALHUB_AI_IMAGE_MODEL = ""
    response = _run_ai_test(admin_api, django_capture_on_commit_callbacks,
                            {"providers": ["image"]})
    job = JobRun.objects.get(pk=response.json()["job"]["id"])
    assert job.status == "succeeded"
    assert set(job.result) == {"image"}
    image = job.result["image"]
    assert image["ok"] is False and image["provider"] == "openai" and image["model"] == ""
    assert image["error_code"] == "provider_not_configured"
    assert image["error_detail"] == "OPENAI_API_KEY is not set."
    assert AIRun.objects.get(pk=image["ai_run_id"]).error_code == "provider_not_configured"


@pytest.mark.parametrize("body", [{"providers": ["text", "video"]}, {"providers": []},
                                  {"providers": "text"}])
def test_ai_test_validates_providers(admin_api, body):
    response = admin_api.post(AI_TEST, body, format="json")
    assert response.status_code == 400 and _code(response) == "validation_error"
    assert response.json()["error"]["fields"][0]["path"] == "providers"


def test_ai_test_conflicts_with_running_test(admin_api):
    JobRun.objects.create(kind="system.ai_test", status="running", target_type="system",
                          target_id="ai")
    response = admin_api.post(AI_TEST, {}, format="json")
    assert response.status_code == 409 and _code(response) == "job_in_progress"


# --- GET /ai/runs/ ---------------------------------------------------------------------------


@pytest.fixture
def runs(db):
    job = JobRun.objects.create(kind="t", target_type="system", target_id="x")
    rows = [
        AIRun.objects.create(provider="anthropic", model="claude-opus-5-5", task="brief.generate",
                             prompt_version="1", input_tokens=4150, output_tokens=1260,
                             units={"attempts": 1}, cost_usd=Decimal("0.041900"),
                             latency_ms=9420, status="ok", provider_request_id="req_1",
                             job=job, payload={"request": {}, "response": {"text": "x"},
                                               "truncated": False}),
        AIRun.objects.create(provider="anthropic", model="claude-opus-5-5", task="system.ping",
                             prompt_version="1", input_tokens=20, output_tokens=3,
                             cost_usd=Decimal("0.000140"), latency_ms=1840, status="ok"),
        AIRun.objects.create(provider="fake", model="fake", task="system.ping", status="refused",
                             latency_ms=5),
    ]
    AIRun.objects.filter(pk=rows[2].pk).update(created_at=timezone.now() - timedelta(days=3))
    return rows


def test_runs_list_shape_and_totals(admin_api, runs):
    body = admin_api.get(RUNS, {"page_size": 1}).json()
    assert list(body) == ["count", "next", "previous", "totals", "results"]
    assert body["count"] == 3 and len(body["results"]) == 1
    assert body["totals"] == {"calls": 3, "input_tokens": 4170, "output_tokens": 1263,
                              "cost_usd": "0.042040"}
    first = body["results"][0]
    assert first["id"] == runs[1].pk  # newest first
    assert set(first) == {"id", "created_at", "job", "account", "provider", "model", "task",
                          "prompt_version", "input_tokens", "output_tokens", "units",
                          "cost_usd", "latency_ms", "status", "error_code",
                          "provider_request_id"}
    assert first["cost_usd"] == "0.000140" and first["created_at"].endswith("Z")


def test_runs_filters_and_ordering(admin_api, runs):
    def ids(**params):
        return [r["id"] for r in admin_api.get(RUNS, params).json()["results"]]

    assert ids(task="system.ping") == [runs[1].pk, runs[2].pk]
    assert ids(provider="fake") == [runs[2].pk]
    assert ids(status="ok", ordering="-cost_usd") == [runs[0].pk, runs[1].pk]
    assert ids(job=str(runs[0].job_id)) == [runs[0].pk]
    since = (timezone.now() - timedelta(days=1)).isoformat()
    assert runs[2].pk not in ids(created_after=since)
    assert ids(created_before=since) == [runs[2].pk]
    assert ids(ordering="-latency_ms")[0] == runs[0].pk
    assert ids(ordering="created_at")[0] == runs[2].pk
    filtered = admin_api.get(RUNS, {"task": "system.ping"}).json()["totals"]
    assert filtered["calls"] == 2 and filtered["cost_usd"] == "0.000140"


@pytest.mark.parametrize("params", [{"ordering": "model"}, {"status": "done"},
                                    {"job": "not-a-uuid"}, {"created_after": "yesterday"}])
def test_runs_bad_filters(admin_api, params):
    response = admin_api.get(RUNS, params)
    assert response.status_code == 400 and _code(response) == "validation_error"


def test_run_detail_has_payload(admin_api, runs):
    body = admin_api.get(f"{RUNS}{runs[0].pk}/").json()
    assert body["payload"]["response"] == {"text": "x"}
    assert body["job"] == str(runs[0].job_id)
    assert admin_api.get(f"{RUNS}{runs[1].pk}/").json()["payload"] is None
    assert admin_api.get(f"{RUNS}999999/").status_code == 404
    assert admin_api.get(f"{RUNS}abc/").status_code == 404


# --- pruning (AC11) --------------------------------------------------------------------------


def test_prune_nulls_old_payloads_only():
    old = AIRun.objects.create(provider="fake", task="system.ping", status="ok",
                               input_tokens=5, cost_usd=Decimal("0.1"),
                               payload={"request": {"user": "x"}})
    recent = AIRun.objects.create(provider="fake", task="system.ping", status="ok",
                                  payload={"request": {"user": "y"}})
    AIRun.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=31))
    assert prune_payloads.apply().get() == 1
    old.refresh_from_db()
    recent.refresh_from_db()
    assert old.payload is None and recent.payload is not None
    assert (old.input_tokens, old.cost_usd, old.status) == (5, Decimal("0.100000"), "ok")


def test_prune_is_scheduled_daily():
    entry = django_settings.CELERY_BEAT_SCHEDULE["ai.prune_payloads"]
    assert entry["task"] == "ai.prune_payloads"
    assert (entry["schedule"].hour, entry["schedule"].minute) == ({2}, {30})


# --- settings (AC14, rules 35-36) ------------------------------------------------------------


def test_old_provider_settings_are_gone():
    assert not hasattr(django_settings, "SOCIALHUB_MODEL_PROVIDER")
    assert not hasattr(django_settings, "SOCIALHUB_SOURCE_PROVIDER")
    assert not (BACKEND / "apps" / "core" / "providers.py").exists()


def _import_settings(**env):
    base = {k: v for k, v in os.environ.items()
            if not k.startswith(("SOCIALHUB_", "DJANGO_", "ANTHROPIC", "OPENAI"))}
    base.update({"DJANGO_SECRET_KEY": "x", "SOCIALHUB_MEDIA_BACKEND": "s3",
                 "SOCIALHUB_S3_BUCKET": "b", "SOCIALHUB_S3_ACCESS_KEY_ID": "a",
                 "SOCIALHUB_S3_SECRET_ACCESS_KEY": "s", **env})
    return subprocess.run([sys.executable, "-c", "import config.settings"], cwd=BACKEND,
                          env=base, capture_output=True, text=True, timeout=60)


def test_fake_provider_refused_without_debug():
    result = _import_settings(DJANGO_DEBUG="false")
    assert result.returncode != 0 and "fake AI provider" in result.stderr
    result = _import_settings(DJANGO_DEBUG="false", SOCIALHUB_AI_TEXT_PROVIDER="anthropic",
                              SOCIALHUB_AI_IMAGE_PROVIDER="openai")
    # Other production rules (for example the encryption key) may still refuse; not this one.
    assert "fake AI provider" not in result.stderr
    result = _import_settings(DJANGO_DEBUG="true")  # boots without the old provider variables
    assert result.returncode == 0, result.stderr
