"""Brand logo validation and storage (E00-S03 rule 22).

PNG: 256-4096 px on each side. SVG: no `<script>`, no `on…` attributes, no external references
(`href`/`xlink:href`, CSS `url(...)`, `@import` or `<?xml-stylesheet?>` pointing anywhere but
`#…` or `data:`), no entity declarations. Both at most 2 MB (larger is `413`).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import PurePath

import filetype
from django.core.files.storage import storages
from django.db import transaction
from PIL import Image

from apps.core.errors import PayloadTooLarge, UnsupportedMedia
from apps.core.storage import brand_key
from apps.core.uploads import MB, PNG, UploadProfile, validate_upload

from .models import BrandProfile

LOGO_MAX_BYTES = 2 * MB
PNG_MIN_SIDE = 256
PNG_MAX_SIDE = 4096
VARIANTS = ("light", "dark")
LOGO_PNG = UploadProfile("brand_logo", (PNG,), LOGO_MAX_BYTES)

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_SVG_NS = "http://www.w3.org/2000/svg"
_URL_RE = re.compile(r"url\(\s*['\"]?\s*([^'\")\s]*)", re.IGNORECASE)
_FIELD = "file"


def _local(name: str) -> str:
    return name.rsplit("}", 1)[-1] if name.startswith("{") else name.rsplit(":", 1)[-1]


def _is_internal(target: str) -> bool:
    target = target.strip()
    return target.startswith("#") or target.lower().startswith("data:")


def _external_css(text: str) -> bool:
    if "@import" in text.lower():
        return True
    return any(not _is_internal(match) for match in _URL_RE.findall(text))


def _check_png(uploaded) -> str:
    info = validate_upload(uploaded, LOGO_PNG, field=_FIELD)
    try:
        uploaded.seek(0)
        with Image.open(uploaded) as image:
            width, height = image.size
            image.verify()
    except Image.DecompressionBombError:
        raise UnsupportedMedia(_FIELD, "dimensions_out_of_range") from None
    except Exception:  # noqa: BLE001 - any decoder failure means a broken file
        raise UnsupportedMedia(_FIELD, "invalid_image") from None
    finally:
        uploaded.seek(0)
    if not (PNG_MIN_SIDE <= width <= PNG_MAX_SIDE and PNG_MIN_SIDE <= height <= PNG_MAX_SIDE):
        raise UnsupportedMedia(_FIELD, "dimensions_out_of_range")
    return info.ext


def _check_svg(uploaded, raw: bytes) -> str:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise UnsupportedMedia(_FIELD, "type_not_allowed") from None
    if "<!entity" in text.lower():
        raise UnsupportedMedia(_FIELD, "invalid_svg")
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise UnsupportedMedia(_FIELD, "type_not_allowed") from None
    if root.tag not in (f"{{{_SVG_NS}}}svg", "svg"):
        raise UnsupportedMedia(_FIELD, "type_not_allowed")
    if PurePath(uploaded.name or "").suffix.lower() != ".svg":
        raise UnsupportedMedia(_FIELD, "extension_mismatch")
    if re.search(r"<\?xml-stylesheet", text, re.IGNORECASE):
        raise UnsupportedMedia(_FIELD, "svg_external_reference")

    for element in root.iter():
        if not isinstance(element.tag, str):
            continue
        tag = _local(element.tag).lower()
        if tag == "script":
            raise UnsupportedMedia(_FIELD, "svg_script")
        if tag == "style" and _external_css(element.text or ""):
            raise UnsupportedMedia(_FIELD, "svg_external_reference")
        for name, value in element.attrib.items():
            attr = _local(name).lower()
            if attr.startswith("on"):
                raise UnsupportedMedia(_FIELD, "svg_event_handler")
            if attr == "href" and not _is_internal(value):
                raise UnsupportedMedia(_FIELD, "svg_external_reference")
            if _external_css(value):  # style="background:url(http://…)", fill="url(…)"
                raise UnsupportedMedia(_FIELD, "svg_external_reference")
    return "svg"


def validate_logo(uploaded) -> str:
    """Check an uploaded logo; return its stored extension (`png` or `svg`).

    Raises `PayloadTooLarge` above 2 MB and `UnsupportedMedia` (field `file`) otherwise.
    """
    size = getattr(uploaded, "size", None) or 0
    if size > LOGO_MAX_BYTES:
        raise PayloadTooLarge(details={"max_bytes": LOGO_MAX_BYTES})
    if size == 0:
        raise UnsupportedMedia(_FIELD, "empty_file")
    uploaded.seek(0)
    raw = uploaded.read(LOGO_MAX_BYTES + 1)
    uploaded.seek(0)
    if len(raw) > LOGO_MAX_BYTES:
        raise PayloadTooLarge(details={"max_bytes": LOGO_MAX_BYTES})
    if raw.startswith(_PNG_SIGNATURE):
        return _check_png(uploaded)
    if filetype.guess(raw[:8192]) is not None:  # a known binary type that is not PNG
        raise UnsupportedMedia(_FIELD, "type_not_allowed")
    return _check_svg(uploaded, raw)


def _field(brand: BrandProfile, variant: str):
    return brand.logo_light if variant == "light" else brand.logo_dark


def _delete_later(key: str | None) -> None:
    if key:
        transaction.on_commit(lambda: storages["default"].delete(key))


def store_logo(brand: BrandProfile, variant: str, uploaded, ext: str) -> None:
    """Save a validated logo under `accounts/{id}/brand/` and replace the variant's old file."""
    old = _field(brand, variant).name or None
    key = storages["default"].save(brand_key(brand.account_id, variant, ext), uploaded)
    setattr(brand, f"logo_{variant}", key)
    brand.save()
    if old and old != key:
        _delete_later(old)


def remove_logo(brand: BrandProfile, variant: str) -> bool:
    """Clear a logo variant (the file is deleted after commit). Returns whether one was set."""
    old = _field(brand, variant).name or None
    if not old:
        return False
    setattr(brand, f"logo_{variant}", None)
    _delete_later(old)
    return True
