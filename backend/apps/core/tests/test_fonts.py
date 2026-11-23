"""E00-S03 rule 24: the bundled font registry and `GET /fonts/`."""

from pathlib import Path

import pytest
from django.contrib.staticfiles import finders

from apps.core.fonts import registry

KEYS = ["vazirmatn", "noto-sans-arabic", "noto-naskh-arabic", "inter", "noto-sans"]


def test_registry_lists_the_mvp_fonts_with_files():
    assert [font["key"] for font in registry.list_fonts()] == KEYS
    for font in registry.list_fonts():
        assert set(font) == {"key", "name", "family", "scripts", "weights", "files"}
        assert font["weights"] == [400, 700]
        assert set(font["files"]) == {400, 700}
        for path in font["files"].values():
            assert isinstance(path, Path) and path.is_file() and path.stat().st_size > 0


def test_get_font():
    font = registry.get_font("vazirmatn")
    assert font["name"] == font["family"] == "Vazirmatn"
    assert font["scripts"] == ["arabic", "latin"]
    assert font["files"][700].name == "vazirmatn-700.woff2"
    with pytest.raises(KeyError):
        registry.get_font("comic-sans")
    assert registry.is_font_key("inter") and not registry.is_font_key("Inter")


@pytest.mark.parametrize("key", KEYS)
def test_font_files_are_static_files(key):
    for weight in (400, 700):
        found = finders.find(registry.static_path(key, weight))
        assert found and Path(found) == registry.get_font(key)["files"][weight]


@pytest.mark.django_db
def test_fonts_endpoint(operator_api, client):
    response = operator_api.get("/api/v1/fonts/")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"results"}
    assert [font["key"] for font in body["results"]] == KEYS
    vazirmatn = body["results"][0]
    assert vazirmatn == {
        "key": "vazirmatn",
        "name": "Vazirmatn",
        "scripts": ["arabic", "latin"],
        "weights": [400, 700],
        "files": {"400": "http://testserver/static/fonts/vazirmatn-400.woff2",
                  "700": "http://testserver/static/fonts/vazirmatn-700.woff2"},
    }
    assert body["results"][1]["files"]["700"].endswith("/static/fonts/noto-sans-arabic-700.ttf")
    assert client.get("/api/v1/fonts/").status_code == 403
