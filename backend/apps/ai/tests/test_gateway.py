import ast
from pathlib import Path
from unittest import mock

from django.test import TestCase, override_settings

from apps.accounts.models import InstagramAccount
from apps.ai import gateway
from apps.ai.errors import CallLimitExceeded, ProviderError, ProviderNotConfigured, ProviderRefused
from apps.ai.models import AIRun
from apps.ai.providers.fake import fake_text, load_fixture, resolve_references
from apps.ai.registry import load_task
from apps.ai.results import WebSearchOptions
from apps.ai.tasks import TASKS
from apps.core.jobs import register_job_kind, start_job

register_job_kind("test.ai", task="tests.ai", target_type="system")


class GatewayTests(TestCase):
    def setUp(self):
        self.addCleanup(fake_text.clear)
        sleeper = mock.patch.object(gateway, "_sleep")
        self.sleep = sleeper.start()
        self.addCleanup(sleeper.stop)

    def test_fake_text_writes_airun(self):
        result = gateway.run_text("system.ping", variables={})
        self.assertEqual(result.data, "pong")
        run = AIRun.objects.get(pk=result.ai_run_id)
        self.assertEqual((run.provider, run.status, run.cost_usd), ("fake", "ok", 0))
        self.assertEqual(run.prompt_version, "1")

    def test_web_search_returns_citations(self):
        result = gateway.run_text(
            "research.web_search",
            variables={
                "query": "q", "window_start": "2026-11-15", "window_end": "2026-11-22",
                "content_language": "fa", "audience_summary": "", "content_pillars": [],
                "objective": "",
            },
            web_search=WebSearchOptions(),
        )
        self.assertEqual(len(result.citations), 2)

    def test_schema_and_web_search_together_is_an_error(self):
        with self.assertRaises(ValueError):
            gateway.run_text("research.extract_signals", variables={}, web_search=WebSearchOptions())

    def test_missing_variable_fails_before_call(self):
        import jinja2

        with self.assertRaises(jinja2.UndefinedError):
            gateway.run_text("research.web_search", variables={})
        self.assertEqual(AIRun.objects.count(), 0)

    def test_retries_then_succeeds(self):
        attempts = []

        def flaky(variables):
            attempts.append(1)
            if len(attempts) < 3:
                raise ProviderError("rate_limited", retryable=True, retry_after=12)
            return "pong"

        fake_text.set("system.ping", flaky)
        result = gateway.run_text("system.ping", variables={})
        self.assertEqual(result.data, "pong")
        self.assertEqual([c.args[0] for c in self.sleep.call_args_list], [12, 12])
        self.assertEqual(AIRun.objects.get().units["attempts"], 3)

    def test_default_survives_clear(self):
        fake_text.set_default("system.ping", lambda variables: "computed")
        self.addCleanup(fake_text._defaults.pop, "system.ping", None)
        fake_text.set("system.ping", "override")
        self.assertEqual(gateway.run_text("system.ping", variables={}).data, "override")
        fake_text.clear()
        self.assertEqual(gateway.run_text("system.ping", variables={}).data, "computed")

    def test_refusal_is_recorded(self):
        fake_text.set("system.ping", ProviderRefused())
        with self.assertRaises(ProviderRefused):
            gateway.run_text("system.ping", variables={})
        self.assertEqual(AIRun.objects.get().status, "refused")

    def test_call_limit(self):
        job = start_job("test.ai", target_id="x")
        with override_settings(SOCIALHUB_AI_MAX_CALLS_PER_JOB=2):
            gateway.run_text("system.ping", variables={}, job_id=job.id)
            gateway.run_text("system.ping", variables={}, job_id=job.id)
            with self.assertRaises(CallLimitExceeded) as ctx:
                gateway.run_text("system.ping", variables={}, job_id=job.id)
        self.assertEqual((ctx.exception.code, ctx.exception.detail), ("provider_error", "call_limit"))

    @override_settings(SOCIALHUB_AI_TEXT_PROVIDER="anthropic", ANTHROPIC_API_KEY="")
    def test_not_configured(self):
        with self.assertRaises(ProviderNotConfigured):
            gateway.ensure_text_provider()
        with self.assertRaises(ProviderNotConfigured):
            gateway.run_text("system.ping", variables={})
        self.assertEqual(AIRun.objects.get().error_code, "provider_not_configured")

    def test_brand_block_with_account(self):
        account = InstagramAccount.objects.create(handle="brand", display_name="Brand")
        result = gateway.run_text("system.ping", variables={}, account_id=account.pk)
        payload = AIRun.objects.get(pk=result.ai_run_id).payload
        self.assertIn("user", payload["request"])

    def test_cost_from_price_table(self):
        cost, missing = gateway._cost("claude-opus-5-5", 1_000_000, 100_000, {"cache_read_tokens": 1_000_000})
        self.assertEqual(str(cost), "6.200000")
        self.assertFalse(missing)
        self.assertTrue(gateway._cost("unknown-model", 10, 10, {})[1])


class RegistryTests(TestCase):
    def test_every_schema_task_has_valid_fixtures(self):
        for key in TASKS:
            prompt = load_task(key)
            for path in sorted(prompt.directory.glob("fixture*.json")):
                variant = path.stem.partition(".")[2] or None
                raw = load_fixture(key, variant)
                if isinstance(raw, dict) and "_raise" in raw:
                    continue
                if prompt.schema is not None:
                    raw = resolve_references(raw, {"signals": [{"id": 1}, {"id": 2}, {"id": 3}]})
                    prompt.schema.model_validate(raw)

    def test_only_providers_import_sdks(self):
        root = Path(__file__).resolve().parents[2]
        offenders = []
        for path in root.rglob("*.py"):
            if "providers" in path.parts or "tests" in path.parts:
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                names = []
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.module:
                    names = [node.module]
                if any(name.split(".")[0] in ("anthropic", "openai") for name in names):
                    offenders.append(str(path))
        self.assertEqual(offenders, [])
