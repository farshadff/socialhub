"""E00-S03-BE3: brand profile and logo endpoints."""

import io

import pytest
from django.core.files.storage import storages
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.accounts.brand import brand_warnings, contrast_ratio

from .factories import make_account

pytestmark = pytest.mark.django_db

VALID_BRAND = {
    "colors": {"primary": "#0b6e4f", "secondary": "#21295C", "accent": "#F2A541",
               "background": "#FFFFFF", "text": "#1B1B1B"},
    "fonts": {"heading": "vazirmatn", "body": "noto-sans-arabic"},
    "tone_of_voice": "Warm, practical and encouraging.",
    "audience_summary": "Homeowners aged 28-45 in large cities.",
    "content_pillars": ["Energy saving tips"],
    "default_hashtags": ["#خانه_سبز"],
    "banned_terms": [],
    "cta_examples": [],
    "handle_display": "@greenhome.ir",
    "ai_disclosure": "generated_only",
}


def brand_url(account) -> str:
    return f"/api/v1/accounts/{account.pk}/brand/"


def logo_url(account) -> str:
    return f"/api/v1/accounts/{account.pk}/brand/logo/"


def field_errors(response) -> set[tuple[str, str]]:
    return {(f["path"], f["code"]) for f in response.json()["error"]["fields"]}


def png(width=512, height=512) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", (width, height), (11, 110, 79, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


def upload(client, account, content: bytes, name: str, variant="light"):
    file = SimpleUploadedFile(name, content)
    data = {"file": file} if variant is None else {"file": file, "variant": variant}
    return client.post(logo_url(account), data, format="multipart")


CLEAN_SVG = b"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 100 100">
  <defs><linearGradient id="g"><stop offset="0" stop-color="#0B6E4F"/></linearGradient></defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <use xlink:href="#g"/>
  <image href="data:image/png;base64,iVBORw0KGgo="/>
</svg>"""


def svg(body: str) -> bytes:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink">{body}</svg>').encode()


# --- read and update ----------------------------------------------------------------------


def test_get_brand_defaults(operator_api):
    account = make_account(handle="greenhome.ir")
    body = operator_api.get(brand_url(account)).json()
    assert body == {
        "account": account.pk,
        "logo_light": None,
        "logo_dark": None,
        "colors": {"primary": "#111111", "secondary": "#666666", "accent": "#1677FF",
                   "background": "#FFFFFF", "text": "#111111"},
        "fonts": {"heading": "vazirmatn", "body": "vazirmatn"},
        "tone_of_voice": "",
        "audience_summary": "",
        "content_pillars": [],
        "default_hashtags": [],
        "banned_terms": [],
        "cta_examples": [],
        "handle_display": "@greenhome.ir",
        "ai_disclosure": "generated_only",
        "complete": False,
        "warnings": [],
        "updated_at": body["updated_at"],
    }
    assert operator_api.get("/api/v1/accounts/999999/brand/").status_code == 404


@pytest.mark.parametrize("role", ["admin", "operator"])
def test_put_brand_normalises(request, role):
    client = request.getfixturevalue(f"{role}_api")
    account = make_account()
    data = {**VALID_BRAND, "default_hashtags": ["#خانه_سبز", "خانه_سبز", "Green", "#green"]}
    response = client.put(brand_url(account), data, format="json")
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["colors"]["primary"] == "#0B6E4F"
    assert body["default_hashtags"] == ["خانه_سبز", "Green"]  # AC 9
    assert body["fonts"] == {"heading": "vazirmatn", "body": "noto-sans-arabic"}
    assert body["warnings"] == []
    assert body["complete"] is False  # no light logo yet
    account.brand.refresh_from_db()
    assert account.brand.default_hashtags == ["خانه_سبز", "Green"]


def test_put_requires_every_field(admin_api):
    account = make_account()
    response = admin_api.put(brand_url(account), {"colors": VALID_BRAND["colors"]},
                             format="json")
    assert response.status_code == 400
    paths = {path for path, code in field_errors(response) if code == "required"}
    assert paths == set(VALID_BRAND) - {"colors"}


def test_low_contrast_warning_does_not_block(admin_api):
    """AC 10."""
    account = make_account()
    data = {**VALID_BRAND, "colors": {**VALID_BRAND["colors"], "text": "#BBBBBB"}}
    response = admin_api.put(brand_url(account), data, format="json")
    assert response.status_code == 200
    assert response.json()["warnings"] == [{
        "path": "colors.text", "code": "low_contrast",
        "message": "Text on background contrast is 1.92:1; 4.5:1 or more is recommended.",
    }]
    assert admin_api.get(brand_url(account)).json()["warnings"][0]["code"] == "low_contrast"


@pytest.mark.parametrize("fg, bg, ratio", [
    ("#000000", "#FFFFFF", 21.0),
    ("#FFFFFF", "#000000", 21.0),
    ("#777777", "#FFFFFF", 4.48),
    ("#FFFFFF", "#FFFFFF", 1.0),
])
def test_contrast_ratio(fg, bg, ratio):
    assert round(contrast_ratio(fg, bg), 2) == ratio


def test_contrast_warning_threshold():
    assert brand_warnings({"text": "#777777", "background": "#FFFFFF"})[0]["code"] == \
        "low_contrast"
    assert brand_warnings({"text": "#767676", "background": "#FFFFFF"}) == []  # 4.54:1


def _replace(key, value):
    return {**VALID_BRAND, key: value}


def _color(key, value):
    colors = {**VALID_BRAND["colors"], key: value}
    if value is None:
        colors.pop(key)
    return _replace("colors", colors)


BRAND_LIMITS = [
    # (payload, expected (path, code)) — None as expected means the payload is valid.
    (_color("accent", None), ("colors.accent", "required")),
    (_color("accent", "#12345"), ("colors.accent", "invalid")),
    (_color("accent", "red"), ("colors.accent", "invalid")),
    (_color("accent", "#GGGGGG"), ("colors.accent", "invalid")),
    (_replace("colors", {**VALID_BRAND["colors"], "extra": "#FFFFFF"}),
     ("colors.extra", "invalid")),
    (_replace("colors", "blue"), ("colors", "invalid")),
    (_replace("fonts", {"heading": "comic-sans", "body": "vazirmatn"}),
     ("fonts.heading", "does_not_exist")),
    (_replace("fonts", {"heading": "inter"}), ("fonts.body", "required")),
    (_replace("tone_of_voice", "x" * 2000), None),
    (_replace("tone_of_voice", "x" * 2001), ("tone_of_voice", "max_length")),
    (_replace("audience_summary", "x" * 2001), ("audience_summary", "max_length")),
    (_replace("content_pillars", ["p"] * 10), None),
    (_replace("content_pillars", ["p"] * 11), ("content_pillars", "max_length")),
    (_replace("content_pillars", ["x" * 81]), ("content_pillars.0", "max_length")),
    (_replace("content_pillars", [""]), ("content_pillars.0", "blank")),
    (_replace("default_hashtags", [f"t{i}" for i in range(30)]), None),
    (_replace("default_hashtags", [f"t{i}" for i in range(31)]),
     ("default_hashtags", "max_length")),
    (_replace("default_hashtags", ["has space"]), ("default_hashtags.0", "invalid")),
    (_replace("default_hashtags", ["ok", "##double"]), ("default_hashtags.1", "invalid")),
    (_replace("default_hashtags", ["x" * 101]), ("default_hashtags.0", "invalid")),
    (_replace("default_hashtags", ["#"]), ("default_hashtags.0", "invalid")),
    (_replace("banned_terms", ["b"] * 100), None),
    (_replace("banned_terms", ["b"] * 101), ("banned_terms", "max_length")),
    (_replace("banned_terms", ["ok", "ok", "ok", "x" * 81]), ("banned_terms.3", "max_length")),
    (_replace("cta_examples", ["c"] * 11), ("cta_examples", "max_length")),
    (_replace("cta_examples", ["x" * 201]), ("cta_examples.0", "max_length")),
    (_replace("cta_examples", ["x" * 200]), None),
    (_replace("handle_display", ""), ("handle_display", "blank")),
    (_replace("handle_display", "x" * 41), ("handle_display", "max_length")),
    (_replace("ai_disclosure", "sometimes"), ("ai_disclosure", "invalid_choice")),
    (_replace("ai_disclosure", "always"), None),
]


@pytest.mark.parametrize("payload, expected", BRAND_LIMITS)
def test_brand_limits(admin_api, payload, expected):
    account = make_account()
    response = admin_api.put(brand_url(account), payload, format="json")
    if expected is None:
        assert response.status_code == 200, response.json()
    else:
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "validation_error"
        assert expected in field_errors(response), field_errors(response)


# --- logos --------------------------------------------------------------------------------


def test_upload_png_logo_and_complete(operator_api):
    """AC 12."""
    account = make_account(brand={"tone_of_voice": "Warm."})
    response = upload(operator_api, account, png(), "logo.png", "light")
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["logo_light"].startswith(
        f"http://localhost:8000/media/accounts/{account.pk}/brand/logo-light-")
    assert body["logo_light"].endswith(".png")
    assert body["logo_dark"] is None
    assert body["complete"] is True
    key = account.brand.__class__.objects.get(pk=account.brand.pk).logo_light.name
    assert storages["default"].exists(key)


def test_new_upload_replaces_previous_file(admin_api, django_capture_on_commit_callbacks):
    account = make_account()
    with django_capture_on_commit_callbacks(execute=True):
        upload(admin_api, account, png(), "first.png", "dark")
    first = account.brand.__class__.objects.get(pk=account.brand.pk).logo_dark.name
    with django_capture_on_commit_callbacks(execute=True):
        response = upload(admin_api, account, CLEAN_SVG, "second.svg", "dark")
    assert response.status_code == 200
    second = account.brand.__class__.objects.get(pk=account.brand.pk).logo_dark.name
    assert second.endswith(".svg") and second != first
    assert not storages["default"].exists(first)
    assert storages["default"].exists(second)


def test_put_null_removes_logo_and_other_values_are_ignored(
        admin_api, django_capture_on_commit_callbacks):
    account = make_account()
    upload(admin_api, account, png(), "logo.png", "light")
    upload(admin_api, account, png(), "logo.png", "dark")
    key = account.brand.__class__.objects.get(pk=account.brand.pk).logo_light.name
    with django_capture_on_commit_callbacks(execute=True):
        response = admin_api.put(brand_url(account), {**VALID_BRAND, "logo_light": None,
                                                      "logo_dark": "http://evil/x.png"},
                                 format="json")
    assert response.status_code == 200
    assert response.json()["logo_light"] is None
    assert response.json()["logo_dark"].startswith("http://localhost:8000/media/")
    assert not storages["default"].exists(key)


LOGO_CASES = [
    # (content, name, status, error code, reason)
    (png(512, 256), "logo.png", 200, None, None),
    (png(256, 256), "logo.png", 200, None, None),
    (png(4096, 300), "logo.png", 200, None, None),
    (png(100, 100), "tiny.png", 400, "unsupported_media", "dimensions_out_of_range"),
    (png(4097, 300), "wide.png", 400, "unsupported_media", "dimensions_out_of_range"),
    (png(255, 512), "narrow.png", 400, "unsupported_media", "dimensions_out_of_range"),
    (png(), "logo.svg", 400, "unsupported_media", "extension_mismatch"),
    (b"\x89PNG\r\n\x1a\n" + b"\0" * (3 * 1024 * 1024), "big.png", 413, "payload_too_large",
     None),
    (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\0" * 64, "photo.jpg", 400, "unsupported_media",
     "type_not_allowed"),
    (b"", "empty.png", 400, "unsupported_media", "empty_file"),
    (b"hello world", "notes.txt", 400, "unsupported_media", "type_not_allowed"),
    (CLEAN_SVG, "logo.svg", 200, None, None),
    (CLEAN_SVG, "logo.png", 400, "unsupported_media", "extension_mismatch"),
    (svg('<script>alert(1)</script>'), "x.svg", 400, "unsupported_media", "svg_script"),
    (svg('<g><svg:script xmlns:svg="http://www.w3.org/2000/svg"/></g>'), "x.svg", 400,
     "unsupported_media", "svg_script"),
    (svg('<rect onload="alert(1)"/>'), "x.svg", 400, "unsupported_media", "svg_event_handler"),
    (svg('<rect ONCLICK="x()"/>'), "x.svg", 400, "unsupported_media", "svg_event_handler"),
    (svg('<image href="https://example.com/a.png"/>'), "x.svg", 400, "unsupported_media",
     "svg_external_reference"),
    (svg('<use xlink:href="other.svg#id"/>'), "x.svg", 400, "unsupported_media",
     "svg_external_reference"),
    (svg('<a href="javascript:alert(1)"><rect/></a>'), "x.svg", 400, "unsupported_media",
     "svg_external_reference"),
    (svg('<rect style="fill:url(https://example.com/x.svg#p)"/>'), "x.svg", 400,
     "unsupported_media", "svg_external_reference"),
    (svg('<style>@import url("https://example.com/x.css");</style>'), "x.svg", 400,
     "unsupported_media", "svg_external_reference"),
    (b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]>'
     b'<svg xmlns="http://www.w3.org/2000/svg">&a;</svg>', "x.svg", 400, "unsupported_media",
     "invalid_svg"),
    (b"<html><body>hi</body></html>", "x.svg", 400, "unsupported_media", "type_not_allowed"),
    (b"<svg", "x.svg", 400, "unsupported_media", "type_not_allowed"),
]


@pytest.mark.parametrize("content, name, status, code, reason", LOGO_CASES)
def test_logo_validation(admin_api, content, name, status, code, reason):
    account = make_account()
    response = upload(admin_api, account, content, name)
    assert response.status_code == status, response.json()
    if code:
        error = response.json()["error"]
        assert error["code"] == code
        if reason:
            assert error["fields"][0]["path"] == "file"
            assert error["fields"][0]["reason"] == reason
            assert error["details"] == {"reasons": [reason]}
        account.brand.refresh_from_db()
        assert not account.brand.logo_light


@pytest.mark.parametrize("variant, expected", [(None, "required"), ("medium", "invalid_choice")])
def test_logo_variant_required(admin_api, variant, expected):
    account = make_account()
    response = upload(admin_api, account, png(), "logo.png", variant)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert ("variant", expected) in field_errors(response)


def test_logo_file_required_and_unknown_account(admin_api):
    account = make_account()
    response = admin_api.post(logo_url(account), {"variant": "light"}, format="multipart")
    assert response.status_code == 400
    assert ("file", "required") in field_errors(response)
    response = admin_api.post("/api/v1/accounts/999999/brand/logo/",
                              {"variant": "light", "file": SimpleUploadedFile("l.png", png())},
                              format="multipart")
    assert response.status_code == 404
