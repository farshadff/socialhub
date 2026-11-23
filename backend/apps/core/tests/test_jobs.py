"""E00-S06 job service, task decorator, sweeper and registry tests (eager Celery)."""

import logging
import threading
from datetime import timedelta
from unittest import mock

import pytest
from django.conf import settings
from django.db import connection
from freezegun import freeze_time

from apps.core import jobs
from apps.core.checks import check_job_registry
from apps.core.errors import JobInProgress
from apps.core.models import JobRun
from apps.core.tests.testapp import tasks as test_tasks
from apps.core.tests.testapp.models import DummyItem, JobReference

pytestmark = pytest.mark.django_db


@pytest.fixture
def item():
    return DummyItem.objects.create(pk=88, title="Item 88")


@pytest.fixture
def registry():
    """Snapshot the registry so a test can register extra kinds."""
    saved = (dict(jobs._KINDS), list(jobs._DUPLICATE_KINDS), dict(jobs._DECORATED))
    yield jobs
    jobs._KINDS.clear()
    jobs._KINDS.update(saved[0])
    jobs._DUPLICATE_KINDS[:] = saved[1]
    jobs._DECORATED.clear()
    jobs._DECORATED.update(saved[2])


@pytest.fixture
def finished_signals():
    received = []

    def handler(sender, job, **kwargs):
        received.append(job.pk)

    jobs.job_finished.connect(handler)
    yield received
    jobs.job_finished.disconnect(handler)


def run_job(kind, target_id, capture, **kwargs):
    with capture(execute=True):
        job = jobs.start_job(kind, target_id=target_id, **kwargs)
    job.refresh_from_db()
    return job


# --- starting (rules 1-9) -------------------------------------------------------------------


def test_start_job_creates_queued_job_and_enqueues_after_commit(
        item, admin_user, django_capture_on_commit_callbacks):
    fake_task = mock.Mock()
    with mock.patch.object(jobs, "_celery_task", return_value=fake_task):
        with django_capture_on_commit_callbacks(execute=False) as callbacks:
            job = jobs.start_job("test.echo", target_id=88, account=None, user=admin_user,
                                 request_id="req-1", payload={"mode": "noop"})
            assert job.status == "queued"
            assert job.queue == "default"
            assert job.celery_task_id == str(job.id)
            assert job.target_type == "test_item" and job.target_id == "88"
            item.refresh_from_db()
            assert item.active_job_id == job.id
            fake_task.apply_async.assert_not_called()
        assert len(callbacks) == 1
        callbacks[0]()
    fake_task.apply_async.assert_called_once_with(
        args=[str(job.id)], kwargs={"mode": "noop"}, queue="default", task_id=str(job.id),
        soft_time_limit=1800, time_limit=1860)


def test_render_kind_goes_to_render_queue(item, django_capture_on_commit_callbacks):
    fake_task = mock.Mock()
    with mock.patch.object(jobs, "_celery_task", return_value=fake_task):
        with django_capture_on_commit_callbacks(execute=True):
            job = jobs.start_job("test.render", target_id=88)
    assert job.queue == "render"
    assert fake_task.apply_async.call_args.kwargs["queue"] == "render"


def test_second_start_for_same_target_raises_job_in_progress(item):
    with mock.patch.object(jobs, "_enqueue"):
        first = jobs.start_job("test.echo", target_id=88)
        with pytest.raises(JobInProgress) as excinfo:
            jobs.start_job("test.echo", target_id=88)
    assert excinfo.value.job == first
    assert excinfo.value.status_code == 409
    assert excinfo.value.retryable is True
    assert excinfo.value.details["job"]["id"] == str(first.id)
    assert JobRun.objects.count() == 1


def test_conflicting_kinds_are_refused_on_the_same_target_only():
    with mock.patch.object(jobs, "_enqueue"):
        running = jobs.start_job("test.refresh", target_id=1)
        JobRun.objects.filter(pk=running.pk).update(status="running")
        with pytest.raises(JobInProgress):
            jobs.start_job("test.verify", target_id=1)
        other = jobs.start_job("test.verify", target_id=2)
    assert other.status == "queued"
    assert jobs.conflict_set("test.verify") == {"test.verify", "test.refresh"}


def test_finished_job_does_not_block_a_new_one(item):
    with mock.patch.object(jobs, "_enqueue"):
        first = jobs.start_job("test.echo", target_id=88)
        JobRun.objects.filter(pk=first.pk).update(status="failed")
        second = jobs.start_job("test.echo", target_id=88)
    assert second.pk != first.pk


def test_unique_index_race_becomes_job_in_progress(item):
    """Without the advisory lock (SQLite), the partial unique index still allows one job."""
    with mock.patch.object(jobs, "_enqueue"):
        existing = jobs.start_job("test.echo", target_id=88)
        real_find = jobs._find_conflict
        seen = []

        def racing_find(spec, target_id):
            # The first check misses the other request's row, as in a race.
            seen.append(1)
            return None if len(seen) == 1 else real_find(spec, target_id)

        with mock.patch.object(jobs, "_find_conflict", side_effect=racing_find):
            with pytest.raises(JobInProgress) as excinfo:
                jobs.start_job("test.echo", target_id=88)
    assert excinfo.value.job == existing
    assert JobRun.objects.filter(target_id="88").count() == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.skipif(connection.vendor != "postgresql", reason="needs two PostgreSQL connections")
def test_parallel_starts_create_exactly_one_job():  # pragma: no cover - PostgreSQL only
    DummyItem.objects.create(pk=88)
    barrier = threading.Barrier(2)
    outcomes = []

    def worker():
        barrier.wait()
        try:
            with mock.patch.object(jobs, "_enqueue"):
                jobs.start_job("test.echo", target_id=88)
            outcomes.append("created")
        except JobInProgress:
            outcomes.append("conflict")
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(outcomes) == ["conflict", "created"]
    assert JobRun.objects.count() == 1


def test_payload_must_be_small_json(item):
    with pytest.raises(ValueError):
        jobs.start_job("test.echo", target_id=88, payload={"blob": "x" * (16 * 1024)})
    with pytest.raises(ValueError):
        jobs.start_job("test.echo", target_id=88, payload={"when": object()})
    assert JobRun.objects.count() == 0


def test_unknown_kind_is_refused():
    with pytest.raises(LookupError):
        jobs.start_job("nope.nothing", target_id=1)


def test_enqueue_failure_fails_the_job(item, django_capture_on_commit_callbacks, caplog):
    broken = mock.Mock()
    broken.apply_async.side_effect = ConnectionError("broker down")
    with mock.patch.object(jobs, "_celery_task", return_value=broken):
        with django_capture_on_commit_callbacks(execute=True):
            job = jobs.start_job("test.echo", target_id=88)
    job.refresh_from_db()
    item.refresh_from_db()
    assert job.status == "failed"
    assert job.error_code == "enqueue_failed"
    assert item.active_job_id is None
    assert str(job.id) in caplog.text


# --- running (rules 10-16) ------------------------------------------------------------------


def test_successful_job_lifecycle(item, django_capture_on_commit_callbacks, finished_signals):
    job = run_job("test.echo", 88, django_capture_on_commit_callbacks,
                  payload={"mode": "succeed"})
    item.refresh_from_db()
    assert job.status == "succeeded"
    assert job.progress == 100
    assert job.message == "Done"
    assert job.result == {"qc_run_id": 7}
    assert job.started_at and job.finished_at and job.deadline_at
    assert job.deadline_at == job.started_at + timedelta(seconds=1800)
    assert item.active_job_id is None
    assert finished_signals == [job.pk]


def test_body_returning_without_finishing_succeeds(item, django_capture_on_commit_callbacks):
    job = run_job("test.echo", 88, django_capture_on_commit_callbacks, payload={"mode": "noop"})
    assert job.status == "succeeded"
    assert job.result is None


def test_job_error_fails_with_code_and_detail(item, django_capture_on_commit_callbacks,
                                              finished_signals):
    job = run_job("test.echo", 88, django_capture_on_commit_callbacks,
                  payload={"mode": "job_error"})
    item.refresh_from_db()
    assert job.status == "failed"
    assert job.error_code == "render_failed"
    assert job.error_detail == "Frame 3 overflowed"
    assert job.progress == 30
    assert job.message == "Rendering frame 3 of 5"
    assert item.active_job_id is None
    assert finished_signals == [job.pk]


def test_unexpected_exception_is_server_error_without_traceback(
        item, django_capture_on_commit_callbacks):
    job = run_job("test.echo", 88, django_capture_on_commit_callbacks,
                  payload={"mode": "key_error"})
    assert job.status == "failed"
    assert job.error_code == "server_error"
    assert job.error_detail == f"Unexpected error. Reference: {job.id}."
    assert "Traceback" not in job.error_detail and "secret" not in job.error_detail


def test_soft_time_limit_is_timeout(item, django_capture_on_commit_callbacks):
    job = run_job("test.echo", 88, django_capture_on_commit_callbacks,
                  payload={"mode": "soft_timeout"})
    assert job.status == "failed"
    assert job.error_code == "timeout"
    assert job.error_detail == "The task took longer than 30 minutes."


def test_retry_keeps_job_running_then_succeeds(item, django_capture_on_commit_callbacks):
    test_tasks.CALLS.clear()
    job = run_job("test.echo", 88, django_capture_on_commit_callbacks,
                  payload={"mode": "retry"})
    # Eager Celery does not redeliver; the job waits for the retry while running.
    assert job.status == "running"
    assert job.message == "Retrying (1 of 3)"
    item.refresh_from_db()
    assert item.active_job_id == job.id

    test_tasks.echo.apply(args=[str(job.id)], kwargs={"mode": "retry"}, retries=1)
    job.refresh_from_db()
    assert test_tasks.CALLS == ["retry", "retry"]
    assert job.status == "succeeded"
    assert job.result == {"retries": 1}


def test_retry_message_while_running(item):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.echo", target_id=88)
    job = jobs._begin(str(job.id))
    task = mock.Mock(max_retries=3)
    task.request.retries = 0
    ctx = jobs.JobContext(job, task=task)
    ctx.retry(countdown=10)
    job.refresh_from_db()
    assert job.status == "running"
    assert job.message == "Retrying (1 of 3)"
    task.retry.assert_called_once_with(exc=None, countdown=10, max_retries=3)


def test_duplicate_delivery_after_success_does_not_run_body(
        item, django_capture_on_commit_callbacks):
    job = run_job("test.echo", 88, django_capture_on_commit_callbacks,
                  payload={"mode": "succeed"})
    before = JobRun.objects.values().get(pk=job.pk)
    test_tasks.CALLS.clear()
    test_tasks.echo.apply(args=[str(job.id)], kwargs={"mode": "key_error"})
    assert test_tasks.CALLS == []
    assert JobRun.objects.values().get(pk=job.pk) == before


def test_redelivery_of_running_job_runs_body_again(item):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.echo", target_id=88, payload={"mode": "succeed"})
    JobRun.objects.filter(pk=job.pk).update(status="running")
    test_tasks.CALLS.clear()
    test_tasks.echo.apply(args=[str(job.id)], kwargs={"mode": "succeed"})
    job.refresh_from_db()
    assert test_tasks.CALLS == ["succeed"]
    assert job.status == "succeeded"


def test_progress_rules(item):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.echo", target_id=88)
    job = jobs._begin(str(job.id))
    ctx = jobs.JobContext(job)
    with freeze_time("2026-11-23 09:00:00") as frozen:
        ctx.progress(50, "x" * 200)
        job.refresh_from_db()
        assert job.progress == 50 and len(job.message) == 120
        ctx.progress(20, "Lower")  # never lower
        job.refresh_from_db()
        assert job.progress == 50
        assert job.message == "x" * 120  # merged: written less than a second ago
        frozen.tick(timedelta(seconds=1))
        ctx.progress(60, "Step 3")
        job.refresh_from_db()
        assert (job.progress, job.message) == (60, "Step 3")
        ctx.progress(70, "Step 4")  # merged ...
        ctx.fail("render_failed", "d" * 600)  # ... but kept by the final write
    job.refresh_from_db()
    assert (job.progress, job.message) == (70, "Step 4")
    assert len(job.error_detail) == 500


def test_result_size_is_limited(item):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.echo", target_id=88)
    ctx = jobs.JobContext(jobs._begin(str(job.id)))
    with pytest.raises(ValueError):
        ctx.succeed({"blob": "x" * (16 * 1024)})


def test_registered_exception_mapper():
    class ProviderRefusedError(Exception):
        pass

    with mock.patch.object(jobs, "_EXCEPTION_MAPPERS", []):
        jobs.register_job_exception(ProviderRefusedError,
                                    lambda exc: ("provider_error", "refused"))
        job = mock.Mock(pk="j1", kind="test.echo")
        assert jobs._map_exception(ProviderRefusedError(), job) == ("provider_error", "refused")
        assert jobs._map_exception(jobs.JobError("x", "y"), job) == ("x", "y")


# --- terminal update rules, sweeper, cancel (rules 15, 17, 18) ------------------------------


def test_sweeper_fails_running_job_past_deadline_and_late_succeed_is_ignored(
        item, caplog, finished_signals, django_capture_on_commit_callbacks):
    with freeze_time("2026-11-23 09:00:00") as frozen:
        with mock.patch.object(jobs, "_enqueue"):
            job = jobs.start_job("test.echo", target_id=88)
        job = jobs._begin(str(job.id))
        ctx = jobs.JobContext(job)
        ctx.progress(40, "Checking design")
        frozen.tick(timedelta(minutes=30, seconds=110))  # deadline + 110 s: not yet stale
        assert jobs.sweep_stale_jobs() == 0
        frozen.tick(timedelta(minutes=3))  # deadline passed 5 minutes ago
        with django_capture_on_commit_callbacks(execute=True):
            assert jobs.sweep_stale_jobs() == 1
            assert jobs.sweep_stale_jobs() == 0  # safe to run twice

    job.refresh_from_db()
    item.refresh_from_db()
    assert job.status == "failed"
    assert job.error_code == "stale_job"
    assert job.error_detail == "The task stopped responding and was ended."
    assert job.progress == 40 and job.message == "Checking design"
    assert item.active_job_id is None
    assert finished_signals == [job.pk]

    with caplog.at_level(logging.WARNING, logger="apps.core.jobs"):
        with django_capture_on_commit_callbacks(execute=True):
            assert ctx.succeed({"late": True}) is False
    job.refresh_from_db()
    assert job.status == "failed" and job.result is None
    assert f"job_late_update job_id={job.id}" in caplog.text
    assert finished_signals == [job.pk]


def test_sweeper_fails_jobs_queued_for_six_hours_only():
    with freeze_time("2026-11-23 03:00:00"):
        with mock.patch.object(jobs, "_enqueue"):
            old = jobs.start_job("test.echo", target_id=1)
    with freeze_time("2026-11-23 07:01:00"):
        with mock.patch.object(jobs, "_enqueue"):
            recent = jobs.start_job("test.render", target_id=2)
    with freeze_time("2026-11-23 09:01:00"):
        assert jobs.sweep_stale_jobs() == 1
    old.refresh_from_db()
    recent.refresh_from_db()
    assert old.status == "failed" and old.error_code == "stale_job"
    assert old.error_detail == "The task never started. A worker may be down."
    assert recent.status == "queued"


def test_cancel_queued_job(item, finished_signals, django_capture_on_commit_callbacks):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.echo", target_id=88)
    with mock.patch.object(jobs, "_revoke") as revoke:
        with django_capture_on_commit_callbacks(execute=True):
            assert jobs.cancel_queued_job(job, "Item cancelled") is True
    revoke.assert_called_once_with(str(job.id))
    item.refresh_from_db()
    assert job.status == "cancelled"
    assert job.error_detail == "Item cancelled"
    assert job.finished_at is not None
    assert item.active_job_id is None
    assert finished_signals == [job.pk]


def test_running_job_cannot_be_cancelled(item):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.echo", target_id=88)
    jobs._begin(str(job.id))
    with mock.patch.object(jobs, "_revoke") as revoke:
        assert jobs.cancel_queued_job(job, "nope") is False
    revoke.assert_not_called()
    job.refresh_from_db()
    assert job.status == "running"


def test_active_job_for(item):
    assert jobs.active_job_for("test_connection", 1) is None
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.verify", target_id=1)
    assert jobs.active_job_for("test_connection", "1") == job
    assert jobs.active_job_for("test_connection", 1, kinds=["test.refresh"]) is None
    assert jobs.job_summary(job) == {"id": str(job.id), "kind": "test.verify",
                                     "status": "queued", "progress": 0, "message": ""}


def test_prune_jobs_deletes_old_unreferenced_system_jobs(admin_user):
    def make(status, finished_days_ago, **extra):
        return JobRun.objects.create(
            kind=extra.pop("kind", "test.prunable"), target_type="system", target_id="x",
            status=status, finished_at=now - timedelta(days=finished_days_ago), **extra)

    with freeze_time("2026-11-23 03:15:00"):
        from apps.core import clock

        now = clock.now()
        old_ok = make("succeeded", 8)
        new_ok = make("succeeded", 6)
        old_failed = make("failed", 31)
        new_failed = make("failed", 20)
        by_user = make("succeeded", 8, created_by=admin_user)
        other_kind = make("succeeded", 8, kind="test.echo")
        referenced = make("succeeded", 8)
        JobReference.objects.create(job=referenced)
        active_target = make("succeeded", 8)
        DummyItem.objects.create(pk=5, active_job=active_target)

        assert jobs.prune_jobs() == 2
        assert jobs.prune_jobs() == 0
    remaining = set(JobRun.objects.values_list("pk", flat=True))
    assert old_ok.pk not in remaining and old_failed.pk not in remaining
    assert {new_ok.pk, new_failed.pk, by_user.pk, other_kind.pk, referenced.pk,
            active_target.pk} <= remaining


# --- registry and configuration (rules 1-3, 24) ---------------------------------------------


def test_timeouts():
    assert jobs.timeout_for("production.start") == 45 * 60
    assert jobs.timeout_for("production.render") == 30 * 60
    assert jobs.timeout_for("qc.run") == 15 * 60
    assert jobs.timeout_for("qc.revise") == 60 * 60
    assert jobs.timeout_for("publish.send") == 20 * 60
    assert jobs.timeout_for("publish.verify") == 20 * 60
    assert jobs.timeout_for("anything.else") == 1800


def test_timeout_override(settings, item, django_capture_on_commit_callbacks):
    settings.SOCIALHUB_JOB_TIMEOUT_OVERRIDES = {"test.echo": 60, "qc.run": 120}
    assert jobs.timeout_for("qc.run") == 120
    fake_task = mock.Mock()
    with mock.patch.object(jobs, "_celery_task", return_value=fake_task):
        with django_capture_on_commit_callbacks(execute=True):
            jobs.start_job("test.echo", target_id=88)
    assert fake_task.apply_async.call_args.kwargs["soft_time_limit"] == 60
    assert fake_task.apply_async.call_args.kwargs["time_limit"] == 120
    assert settings.CELERY_BROKER_TRANSPORT_OPTIONS["visibility_timeout"] > 3600 + 60


def test_registry_contract_every_kind_has_a_task_and_every_task_a_kind():
    from celery import current_app

    assert check_job_registry() == []
    for spec in jobs.registered_kinds().values():
        assert spec.task is None or spec.task in current_app.tasks
        assert spec.queue in jobs.QUEUES
    for kind, task_name in jobs._DECORATED.items():
        assert jobs.registered_kinds()[kind].task == task_name


def test_system_check_reports_registry_errors(registry):
    jobs.register_job_kind("bad.task", task="nope.missing", queue="default", target_type="x")
    jobs.register_job_kind("bad.queue", task="core.ping", queue="slow", target_type="x")
    jobs.register_job_kind("test.echo", task="core_testapp.echo", queue="render",
                           target_type="test_item")
    jobs._DECORATED["ghost.kind"] = "ghost.task"
    ids = sorted(error.id for error in check_job_registry())
    assert ids == ["core.E001", "core.E002", "core.E003", "core.E004"]


def test_celery_settings():
    assert settings.CELERY_TASK_DEFAULT_QUEUE == "default"
    assert [q.name for q in settings.CELERY_TASK_QUEUES] == ["default", "render", "publish"]
    assert settings.CELERY_TASK_ACKS_LATE is True
    assert settings.CELERY_TASK_REJECT_ON_WORKER_LOST is True
    assert settings.CELERY_WORKER_PREFETCH_MULTIPLIER == 1
    assert settings.CELERY_TASK_IGNORE_RESULT is True
    assert settings.CELERY_BEAT_SCHEDULE["core.sweep_stale_jobs"]["schedule"] == 300.0
    assert "core.prune_jobs" in settings.CELERY_BEAT_SCHEDULE
    from celery import current_app

    router = current_app.amqp.router
    assert router.route({}, "production.render_frames")["queue"].name == "render"
    assert router.route({}, "publishing.send")["queue"].name == "publish"
    assert router.route({}, "production.generate_copy")["queue"].name == "default"
    assert router.route({}, "core.ping")["queue"].name == "default"


# --- multi-step jobs (@job_step) and parent-only kinds --------------------------------------


def test_parent_only_kind_enqueues_nothing(item, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        job = jobs.start_job("test.pipeline", target_id=88)
    assert callbacks == []
    job.refresh_from_db()
    item.refresh_from_db()
    assert job.status == "queued" and item.active_job_id == job.id
    assert jobs.get_kind("test.pipeline").task is None
    assert check_job_registry() == []


def test_job_step_leaves_job_running_then_a_later_step_finishes(
        item, finished_signals, django_capture_on_commit_callbacks):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.pipeline", target_id=88)
    test_tasks.STEP_CALLS.clear()

    result = test_tasks.step_progress.apply(args=[str(job.id)], kwargs={"percent": 40})
    assert result.get() == {"step": 40}
    job.refresh_from_db()
    assert job.status == "running"  # (a) no auto-succeed
    assert job.started_at and job.deadline_at == job.started_at + timedelta(seconds=1800)
    assert (job.progress, job.message) == (40, "Step at 40")
    started_at = job.started_at

    test_tasks.step_progress.apply(args=[str(job.id)], kwargs={"percent": 70})  # (c) running ok
    job.refresh_from_db()
    assert job.status == "running" and job.progress == 70 and job.started_at == started_at

    with django_capture_on_commit_callbacks(execute=True):
        test_tasks.step_finish.apply(args=[str(job.id)])
    job.refresh_from_db()
    item.refresh_from_db()
    assert job.status == "succeeded" and job.result == {"done": True}
    assert item.active_job_id is None
    assert finished_signals == [job.pk]
    assert test_tasks.STEP_CALLS == [("progress", 40), ("progress", 70), ("finish", None)]


@pytest.mark.parametrize("terminal", ["cancelled", "failed", "succeeded"])
def test_job_step_skips_terminal_jobs(item, terminal):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.pipeline", target_id=88)
    JobRun.objects.filter(pk=job.pk).update(status=terminal)
    test_tasks.STEP_CALLS.clear()
    result = test_tasks.step_progress.apply(args=[str(job.id)])
    assert result.get() is None  # (b) body skipped
    assert test_tasks.STEP_CALLS == []
    job.refresh_from_db()
    assert job.status == terminal and job.progress == 0


def test_job_step_exception_fails_the_job(item, finished_signals,
                                          django_capture_on_commit_callbacks):
    with mock.patch.object(jobs, "_enqueue"):
        job = jobs.start_job("test.pipeline", target_id=88)
    with django_capture_on_commit_callbacks(execute=True):
        test_tasks.step_boom.apply(args=[str(job.id)])
    job.refresh_from_db()
    item.refresh_from_db()
    assert (job.status, job.error_code, job.error_detail) == ("failed", "render_failed",
                                                              "Step failed")
    assert item.active_job_id is None
    assert finished_signals == [job.pk]
