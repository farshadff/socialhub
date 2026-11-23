"""Caption, hashtags and alt text (E06-S06)."""

from __future__ import annotations

import json
import re
import unicodedata

from django.conf import settings
from django.db import transaction
from rest_framework.exceptions import ErrorDetail

from apps.content import formats
from apps.content.models import ContentEvent, ContentVersion
from apps.content.services import pipeline
from apps.core.errors import DetailedValidationError

from . import frames as frame_service
from . import rights

TASK = "copy.generate"
FIRST_LINE_WARN = 125
FEEDBACK_MAX = 1000
_TAG_IN_TEXT = re.compile(r"#([\w‌]+)", re.UNICODE)
_TAG_FORM = re.compile(r"^[\w]+$", re.UNICODE)
DEFAULT_DISCLOSURE = {"en": "Made with the help of AI.",
                      "fa": "این محتوا با کمک هوش مصنوعی تولید شده است."}


class CopyTooLong(Exception):
    code = "copy_too_long"
    detail = "The caption and hashtags do not fit within the limit."


# --- Text helpers -------------------------------------------------------------------------

def full_caption(version_or_caption, hashtags=None) -> str:
    """The one text Instagram receives (rule 2). Shared with E07-S02 and E08."""
    if isinstance(version_or_caption, ContentVersion):
        caption, hashtags = version_or_caption.caption, version_or_caption.hashtags
    else:
        caption = version_or_caption
    caption = (caption or "").rstrip()
    tags = " ".join(f"#{t}" for t in (hashtags or []))
    if caption and tags:
        return f"{caption}\n\n{tags}"
    return caption or tags


def tags_in_caption(caption: str) -> list[str]:
    return _TAG_IN_TEXT.findall(caption or "")


def hashtag_count(caption: str, hashtags: list[str]) -> int:
    seen = {t.casefold() for t in hashtags}
    extra = [t for t in tags_in_caption(caption) if t.casefold() not in seen]
    return len(hashtags) + len(extra)


def normalise_hashtag(tag: str) -> str:
    tag = (tag or "").strip().lstrip("#")
    tag = re.sub(r"[\s‌]+", "_", tag)
    return tag


def normalise_hashtags(tags) -> tuple[list[str], dict]:
    """Clean and de-duplicate; returns (tags, errors by index) for rule 3."""
    out, seen, errors = [], set(), {}
    for i, raw in enumerate(tags or []):
        tag = normalise_hashtag(str(raw))
        if not (2 <= len(tag) <= 50) or not _TAG_FORM.match(tag) or tag.isdigit():
            errors[i] = "invalid"
            continue
        if tag.casefold() in seen:
            continue
        seen.add(tag.casefold())
        out.append(tag)
    return out, errors


def _fold(text: str) -> str:
    text = (text or "").replace("ي", "ی").replace("ك", "ک").replace("‌", "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.casefold()


def banned_matches(texts: dict, banned_terms) -> list[tuple[str, str]]:
    """(field, term) for every banned term found (rule 10)."""
    found = []
    for field, text in texts.items():
        folded = _fold(text if isinstance(text, str) else " ".join(text or []))
        for term in banned_terms or []:
            if term and _fold(term) in folded:
                found.append((field, term))
    return found


def disclosure_text(lang: str) -> str:
    texts = getattr(settings, "SOCIALHUB_AI_DISCLOSURE_TEXT", None) or DEFAULT_DISCLOSURE
    if isinstance(texts, str):
        texts = json.loads(texts)
    return texts.get(lang) or DEFAULT_DISCLOSURE.get(lang) or DEFAULT_DISCLOSURE["en"]


def disclosure_required(version: ContentVersion) -> bool:
    item = version.content_item
    brand = getattr(item.account, "brand", None)
    mode = getattr(brand, "ai_disclosure", "generated_only") or "generated_only"
    if mode == "always":
        return True
    if mode == "never":
        return False
    return rights.uses_ai_generated(version)


def with_disclosure(caption: str, version: ContentVersion) -> str:
    if not caption or not disclosure_required(version):
        return caption
    line = disclosure_text(version.content_item.account.content_language)
    if line in caption:
        return caption
    return f"{caption.rstrip()}\n\n{line}"


def copy_limits(spec) -> dict:
    return {"caption_max_chars": spec.caption_max_chars, "max_hashtags": spec.max_hashtags,
            "alt_text_max_chars": spec.alt_text_max_chars}


def _copy_warnings(version: ContentVersion, first_line: str = "") -> list[dict]:
    brand = getattr(version.content_item.account, "brand", None)
    warnings = []
    for field, term in banned_matches({"caption": version.caption, "hashtags": version.hashtags,
                                       "alt_text": version.alt_text},
                                      getattr(brand, "banned_terms", [])):
        warnings.append({"code": "banned_term", "field": field,
                         "message": f"Contains a banned term: {term}"})
    line = first_line or (version.caption or "").split("\n", 1)[0]
    if len(line) > FIRST_LINE_WARN:
        warnings.append({"code": "first_line_long", "field": "caption",
                         "message": f"The first line is {len(line)} characters; "
                                    f"{FIRST_LINE_WARN} or fewer show before \"more\"."})
    return warnings


def store_copy_warnings(version: ContentVersion, first_line: str = "") -> None:
    steps = dict(version.production_steps or {})
    entry = dict(steps.get("copy") or {})
    entry["warnings"] = _copy_warnings(version, first_line)
    steps["copy"] = entry
    version.production_steps = steps
    version.save(update_fields=["production_steps", "updated_at"])
    frame_service.rebuild_warnings(version)


# --- Generation (rules 5-13) --------------------------------------------------------------

def _variables(version: ContentVersion, *, feedback: str, keep_hashtags: bool,
               avoid_terms=None) -> dict:
    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    brand = getattr(item.account, "brand", None)
    brief = item.current_brief
    defaults, _ = normalise_hashtags(getattr(brand, "default_hashtags", []) or [])
    defaults = defaults[:spec.max_hashtags]
    slots = 0 if keep_hashtags else max(0, spec.max_hashtags - len(defaults))
    reserve = len(disclosure_text(item.account.content_language)) + 2 if (
        disclosure_required(version)) else 0
    script = version.script.payload if version.script else None
    variables = {
        "content_language": item.account.content_language,
        "format": item.format,
        "format_label": spec.label,
        "caption_max_chars": spec.caption_max_chars,
        "disclosure_reserved_chars": reserve,
        "hashtag_slots": slots,
        "default_hashtags": defaults,
        "brief": {k: getattr(brief, k) for k in (
            "role", "objective", "key_message", "cta", "must_include", "must_avoid",
            "audience_note", "references")} if brief else None,
        "script": {"hook": script.get("hook"), "scenario": script.get("scenario"),
                   "cta": script.get("cta")} if script else None,
        "frames": [{"index": f["index"], "headline": f.get("headline", ""),
                    "body": f.get("body", "")} for f in version.frames or []],
        "brand": {"tone_of_voice": getattr(brand, "tone_of_voice", ""),
                  "banned_terms": getattr(brand, "banned_terms", []),
                  "cta_examples": getattr(brand, "cta_examples", []),
                  "handle_display": getattr(brand, "handle_display", ""),
                  "content_pillars": getattr(brand, "content_pillars", [])},
        "current": {"caption": version.caption, "hashtags": version.hashtags,
                    "alt_text": version.alt_text} if feedback else None,
        "feedback": feedback or "",
        "avoid_terms": avoid_terms or [],
    }
    if item.account.content_language == "en":
        variables["_fixture"] = "en"  # fake provider: English fixture
    return variables


def _schema():
    from apps.content.services.ai_schemas import output_schema

    return output_schema(TASK)


def generate_copy(version: ContentVersion, *, feedback: str = "", keep_hashtags: bool = False,
                  job_id=None, progress=None) -> dict:
    from apps.ai.gateway import run_text

    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    brand = getattr(item.account, "brand", None)
    banned = getattr(brand, "banned_terms", []) or []
    progress and progress("Writing caption")
    variables = _variables(version, feedback=feedback, keep_hashtags=keep_hashtags)
    result = run_text(TASK, variables=variables, schema=_schema(), account_id=item.account_id,
                      job_id=job_id)
    data = result.data.model_dump(mode="json")
    ai_run = result.ai_run_id
    progress and progress("Checking banned terms")
    found = banned_matches(data, banned)
    if found:
        variables["avoid_terms"] = sorted({term for _, term in found})
        result = run_text(TASK, variables=variables, schema=_schema(),
                          account_id=item.account_id, job_id=job_id)
        data = result.data.model_dump(mode="json")
        ai_run = result.ai_run_id

    defaults = variables["default_hashtags"]
    if keep_hashtags:
        tags = list(version.hashtags or [])
    else:
        proposed, _ = normalise_hashtags(data.get("hashtags") or [])
        merged, _ = normalise_hashtags(defaults + proposed)
        tags = merged[:spec.max_hashtags]
    caption = with_disclosure((data.get("caption") or "").strip(), version)
    alt_text = (data.get("alt_text") or "").strip() if spec.alt_text_expected else ""
    model_tags = [t for t in tags if t not in defaults]
    while (len(full_caption(caption, tags)) > spec.caption_max_chars
           or hashtag_count(caption, tags) > spec.max_hashtags) and model_tags:
        tags.remove(model_tags.pop())
    if len(full_caption(caption, tags)) > spec.caption_max_chars or (
            hashtag_count(caption, tags) > spec.max_hashtags):
        raise CopyTooLong()
    with transaction.atomic():
        version = ContentVersion.objects.select_for_update().get(pk=version.pk)
        version.caption, version.hashtags = caption, tags
        version.alt_text = alt_text[:spec.alt_text_max_chars]
        version.save(update_fields=["caption", "hashtags", "alt_text", "updated_at"])
        store_copy_warnings(version, data.get("first_line", ""))
        pipeline.log_event(item, ContentEvent.Type.EDITED, message="Copy generated",
                           data={"content_version": version.version, "ai_run": ai_run})
    return {"content_version": version.version,
            "caption_length": len(full_caption(version)), "hashtags": len(tags),
            "ai_run": ai_run, "warnings": len(version.render_warnings or [])}


# --- Editing (rules 14-18) ----------------------------------------------------------------

def validate_copy(version: ContentVersion, data: dict) -> dict:
    item = version.content_item
    spec = formats.get_spec(item.format, item.media_kind)
    caption = data.get("caption", version.caption) or ""
    raw_tags = data.get("hashtags", version.hashtags) or []
    alt_text = (data.get("alt_text", version.alt_text) or "").strip()
    errors = {}
    if not spec.caption_allowed:
        for name in ("caption", "hashtags", "alt_text"):
            if data.get(name):
                errors[name] = [ErrorDetail("not_allowed", code="not_allowed")]
        if errors:
            raise DetailedValidationError(errors)
        return {"caption": "", "hashtags": [], "alt_text": ""}
    if not isinstance(raw_tags, list):
        raise DetailedValidationError({"hashtags": [ErrorDetail("invalid", code="invalid")]})
    tags, tag_errors = normalise_hashtags(raw_tags)
    for index in tag_errors:
        errors[f"hashtags.{index}"] = [ErrorDetail("invalid", code="invalid")]
    caption = with_disclosure(caption.strip(), version)
    if len(full_caption(caption, tags)) > spec.caption_max_chars:
        errors["caption"] = [ErrorDetail("max_length", code="max_length")]
    if hashtag_count(caption, tags) > spec.max_hashtags:
        errors.setdefault("hashtags", []).append(ErrorDetail("max_length", code="max_length"))
    if len(alt_text) > spec.alt_text_max_chars:
        errors["alt_text"] = [ErrorDetail("max_length", code="max_length")]
    if errors:
        raise DetailedValidationError(errors)
    return {"caption": caption, "hashtags": tags, "alt_text": alt_text}


def save_copy(version: ContentVersion, data: dict, *, user=None) -> ContentVersion:
    cleaned = validate_copy(version, data)
    with transaction.atomic():
        version = ContentVersion.objects.select_for_update().get(pk=version.pk)
        version.caption = cleaned["caption"]
        version.hashtags = cleaned["hashtags"]
        version.alt_text = cleaned["alt_text"]
        version.save(update_fields=["caption", "hashtags", "alt_text", "updated_at"])
        store_copy_warnings(version)
        pipeline.log_event(version.content_item, ContentEvent.Type.EDITED, actor=user,
                           message="Copy edited", data={"content_version": version.version})
    return version
