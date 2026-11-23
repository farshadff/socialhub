"""The fake providers (E00-S05 rules 30-32)."""

from __future__ import annotations

import io

import pytest
from PIL import Image

from apps.ai import registry
from apps.ai.errors import ProviderRefused
from apps.ai.gateway import WebSearchOptions, run_image, run_text
from apps.ai.models import AIRun
from apps.ai.providers.fake import WEB_SEARCH_CITATIONS, fake_text, set_shared_override

from .conftest import SCHEMA_PY

pytestmark = pytest.mark.django_db

FAKE_PY = '''
from apps.ai.errors import ProviderRefused


def build(variables, variant):
    if variant == "refused":
        raise ProviderRefused("refused")
    return {"text": f"built {variables['value']} {variant}",
            "citations": [{"url": "https://example.com/x", "title": "X"},
                          {"url": "https://example.com/x", "title": "X dup"}]}
'''


@pytest.fixture
def schema_task(prompt_task):
    prompt_task("t.ideas", {
        "schema.py": SCHEMA_PY,
        "fixture.json": {"ideas": [{"title": "Default", "score": 10}]},
        "fixture.second.json": {"ideas": [{"title": "Second", "score": 20}]},
    })
    return registry.schema_for("t.ideas")


def test_ping_returns_fixture_with_zero_cost():
    result = run_text("system.ping", variables={})
    assert result.data == "pong" and result.citations == []
    run = AIRun.objects.get(pk=result.ai_run_id)
    assert (run.provider, run.model, run.cost_usd, run.input_tokens, run.output_tokens) == (
        "fake", "fake", 0, 0, 0)
    assert run.units.get("price_missing") is None


def test_schema_fixture_is_validated(schema_task):
    result = run_text("t.ideas", variables={"value": 1}, schema=schema_task)
    assert isinstance(result.data, schema_task)
    assert result.data.ideas[0].title == "Default"


def test_variant_from_fixture_variable(schema_task):
    result = run_text("t.ideas", variables={"value": 1, "_fixture": "second"},
                      schema=schema_task)
    assert result.data.ideas[0].title == "Second"


def test_variant_from_caption_marker(schema_task):
    result = run_text("t.ideas", variables={"value": {"caption": "Hi [fixture:second] there"}},
                      schema=schema_task)
    assert result.data.ideas[0].title == "Second"


def test_missing_variant_is_an_error(schema_task):
    with pytest.raises(FileNotFoundError):
        run_text("t.ideas", variables={"value": 1, "_fixture": "nope"}, schema=schema_task)


def test_fake_py_wins_and_can_refuse(prompt_task):
    prompt_task("t.built", {"fake.py": FAKE_PY})
    result = run_text("t.built", variables={"value": "q", "_fixture": "v1"})
    assert result.data == "built q v1"
    assert result.citations == [{"url": "https://example.com/x", "title": "X"}]
    with pytest.raises(ProviderRefused):
        run_text("t.built", variables={"value": "q [fixture:refused]"})
    assert AIRun.objects.filter(status="refused").count() == 1


def test_in_process_override_data_and_exception(schema_task):
    fake_text.set("t.ideas", {"ideas": [{"title": "Override", "score": 1}]})
    assert run_text("t.ideas", variables={"value": 1}, schema=schema_task).data.ideas[0].title \
        == "Override"
    fake_text.set("t.ideas", ProviderRefused())
    with pytest.raises(ProviderRefused):
        run_text("t.ideas", variables={"value": 1}, schema=schema_task)


def test_shared_override_only_with_testing_hooks(settings, schema_task):
    set_shared_override("t.ideas", {"variant": "second"})
    try:
        settings.SOCIALHUB_TESTING_HOOKS = False
        assert run_text("t.ideas", variables={"value": 1},
                        schema=schema_task).data.ideas[0].title == "Default"
        settings.SOCIALHUB_TESTING_HOOKS = True
        fake_text.set("t.ideas", {"ideas": [{"title": "InProcess", "score": 1}]})
        assert run_text("t.ideas", variables={"value": 1},
                        schema=schema_task).data.ideas[0].title == "Second"
        set_shared_override("t.ideas", {"data": {"ideas": [{"title": "Data", "score": 2}]}})
        assert run_text("t.ideas", variables={"value": 1},
                        schema=schema_task).data.ideas[0].title == "Data"
        set_shared_override("t.ideas", {"error": "refused"})
        with pytest.raises(ProviderRefused):
            run_text("t.ideas", variables={"value": 1}, schema=schema_task)
    finally:
        set_shared_override("t.ideas", None)


def test_web_search_returns_two_example_citations(prompt_task):
    """AC10, first half: URL and title pairs without duplicates."""
    prompt_task("t.search", {"fixture.json": {"text": "Search summary"}})
    result = run_text("t.search", variables={"value": 1}, web_search=WebSearchOptions())
    assert result.citations == [dict(c) for c in WEB_SEARCH_CITATIONS]
    assert len({c["url"] for c in result.citations}) == 2
    assert all(c["url"].startswith("https://example.com/") and c["title"]
               for c in result.citations)


def test_fake_image_is_a_seeded_solid_png():
    first = run_image("system.ping_image", prompt="A red apple", size="portrait")
    again = run_image("system.ping_image", prompt="A red apple", size="portrait")
    other = run_image("system.ping_image", prompt="A green pear", size="landscape")
    assert first.mime == "image/png" and (first.width, first.height) == (1024, 1536)
    assert first.content == again.content and first.content != other.content
    with Image.open(io.BytesIO(other.content)) as image:
        assert image.size == (1536, 1024)
        assert len(image.getcolors()) == 1
    run = AIRun.objects.get(pk=first.ai_run_id)
    assert (run.provider, run.cost_usd, run.units["images"]) == ("fake", 0, 1)
