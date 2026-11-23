from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import InstagramAccount
from apps.core import jobs
from apps.core.jobs import JobError, JobInProgress, register_job_kind, run_job, start_job
from apps.core.models import JobRun

register_job_kind("test.echo", task="tests.echo", target_type="system")
register_job_kind("test.other", task="tests.other", target_type="system", conflicts_with=["test.echo"])

calls = []


@jobs.job_task("test.echo")
def echo(ctx, mode="ok"):
    calls.append(mode)
    ctx.progress(50, "Half way", force=True)
    if mode == "error":
        raise JobError("bad_thing", "It broke.")
    if mode == "crash":
        raise RuntimeError("secret detail")
    if mode == "succeed":
        ctx.succeed({"answer": 42})


class JobTests(TestCase):
    def setUp(self):
        calls.clear()
        self.account = InstagramAccount.objects.create(handle="jobs", display_name="Jobs")

    def test_conflict_with_itself_and_registered_conflicts(self):
        job = start_job("test.echo", target_id="ai", account=self.account)
        with self.assertRaises(JobInProgress) as ctx:
            start_job("test.echo", target_id="ai")
        self.assertEqual(ctx.exception.details["job"]["id"], str(job.id))
        with self.assertRaises(JobInProgress):
            start_job("test.other", target_id="ai")
        start_job("test.echo", target_id="other-target")

    def test_enqueue_after_commit(self):
        with mock.patch.object(jobs, "_enqueue") as enqueue:
            with self.captureOnCommitCallbacks(execute=True):
                job = start_job("test.echo", target_id="x", payload={"mode": "ok"})
        enqueue.assert_called_once()
        self.assertEqual(enqueue.call_args.args[0], job.id)

    def test_run_job_success_and_result(self):
        job = start_job("test.echo", target_id="x")
        run_job(job.id, mode="succeed")
        job.refresh_from_db()
        self.assertEqual((job.status, job.progress, job.result), ("succeeded", 100, {"answer": 42}))
        self.assertIsNotNone(job.started_at)

    def test_error_mapping(self):
        job = start_job("test.echo", target_id="e")
        run_job(job.id, mode="error")
        job.refresh_from_db()
        self.assertEqual((job.status, job.error_code, job.error_detail), ("failed", "bad_thing", "It broke."))
        job2 = start_job("test.echo", target_id="c")
        with self.assertLogs("apps.core.jobs", "ERROR"):
            run_job(job2.id, mode="crash")
        job2.refresh_from_db()
        self.assertEqual(job2.error_code, "server_error")
        self.assertNotIn("secret", job2.error_detail)

    def test_terminal_job_is_not_run_again_and_late_updates_ignored(self):
        job = start_job("test.echo", target_id="t")
        run_job(job.id, mode="succeed")
        run_job(job.id, mode="succeed")
        self.assertEqual(calls, ["succeed"])
        with self.assertLogs("apps.core.jobs", "WARNING"):
            self.assertFalse(jobs.fail_job(job, "late"))

    def test_cancel_running(self):
        job = start_job("test.echo", target_id="r")
        JobRun.objects.filter(pk=job.pk).update(status="running")
        job.refresh_from_db()
        with mock.patch.object(jobs, "_revoke"):
            self.assertTrue(jobs.cancel_job(job, "stopped"))
        job.refresh_from_db()
        self.assertEqual(job.status, "cancelled")
        self.assertFalse(jobs.cancel_queued_job(job))


class JobAPITests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        self.operator = User.objects.create_user("op", password="pw")
        self.admin = User.objects.create_superuser("ad", password="pw")
        self.account = InstagramAccount.objects.create(handle="api", display_name="API")
        self.client = APIClient()

    def test_list_requires_account_for_operators(self):
        self.client.force_authenticate(self.operator)
        response = self.client.get("/api/v1/jobs/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["fields"][0]["path"], "account")

    def test_system_jobs_hidden_from_other_operators(self):
        job = start_job("test.echo", target_id="sys", user=self.admin)
        self.client.force_authenticate(self.operator)
        self.assertEqual(self.client.get(f"/api/v1/jobs/{job.id}/").status_code, 404)
        self.client.force_authenticate(self.admin)
        body = self.client.get(f"/api/v1/jobs/{job.id}/").json()
        self.assertEqual(body["kind"], "test.echo")
        self.assertEqual(body["created_by"], {"id": self.admin.pk, "name": "ad"})

    def test_filters(self):
        start_job("test.echo", target_id="a1", account=self.account)
        self.client.force_authenticate(self.operator)
        body = self.client.get(f"/api/v1/jobs/?account={self.account.pk}&kind=test.echo&status=queued").json()
        self.assertEqual(body["count"], 1)
        body = self.client.get(f"/api/v1/jobs/?account={self.account.pk}&status=running").json()
        self.assertEqual(body["count"], 0)
