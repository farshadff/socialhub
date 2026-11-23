"""Generate, edit and approve the brief (E04-S03)."""

from __future__ import annotations

import logging
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ErrorDetail

from apps.core.errors import ApiError, DetailedValidationError, InvalidTransition

from .. import actions, formats, roles
from ..models import Brief, ContentEvent, ContentItem, DocumentStatus, Origin, ScriptVersion
from . import pipeline

logger = logging.getLogger(__name__)

S = ContentItem.Status
WRITABLE_STATUSES = (S.SELECTED, S.BRIEFED, S.SCRIPTED)
TERMINAL = (S.PUBLISHED, S.CANCELLED)
JOB_KIND = "brief.generate"
BATCH_KIND = "brief.generate_batch"
BATCH_MAX_ITEMS = 50
HOLD_WAITING = "Brief waiting for approval"
HOLD_INVALID = "Brief needs fixes before it can be approved"

EDITABLE_FIELDS = ("objective", "key_message", "hook_direction", "audience_note", "cta",
                   "must_include", "must_avoid", "references", "format_notes", "success_metric")
TEXT_LIMITS = {  # field: (min, max, required)
    "objective": (20, 400, True),
    "key_message": (10, 200, True),
    "hook_direction": (10, 300, True),
    "audience_note": (0, 300, False),
    "format_notes": (10, 600, True),
}
LABELS = {"objective": "Objective", "key_message": "Key message",
          "hook_direction": "Hook direction", "audience_note": "Audience note", "cta": "CTA",
          "format_notes": "Format notes", "feedback": "Feedback"}


class VersionConflict(ApiError):
    """Fallback until `apps.core.errors.VersionConflict` (E00) is available."""

    def __init__(self, details: dict):
        super().__init__("version_conflict", 409, details=details)


def _version_conflict(details: dict):
    try:
        from apps.core.errors import VersionConflict as CoreVersionConflict

        return CoreVersionConflict(**details) if _accepts_kwargs(CoreVersionConflict) else (
            CoreVersionConflict(details))
    except ImportError:
        return VersionConflict(details)


def _accepts_kwargs(cls) -> bool:
    import inspect

    try:
        params = inspect.signature(cls.__init__).parameters
    except (TypeError, ValueError):
        return False
    return "latest_version" in params


# --- Validation (rule 2) ------------------------------------------------------------------

def _issue(code, path, message, limit=None, actual=None) -> dict:
    issue = {"code": code, "path": path, "message": message}
    if limit is not None:
        issue["limit"] = limit
    if actual is not None:
        issue["actual"] = actual
    return issue


def _text_issues(path: str, value: str, lo: int, hi: int, required: bool) -> list[dict]:
    value = (value or "").strip()
    label = LABELS.get(path, path)
    if not value:
        return [_issue("text_required", path, f"{label} is required.")] if required else []
    n = len(value)
    if n < lo:
        return [_issue("text_too_short", path, f"{label} is {n} characters; at least {lo} are "
                       "needed.", lo, n)]
    if n > hi:
        return [_issue("text_too_long", path, f"{label} is {n} characters; the limit is {hi}.",
                       hi, n)]
    return []


def _list_issues(path: str, values, max_items: int, max_chars: int) -> list[dict]:
    values = values or []
    issues = []
    if len(values) > max_items:
        issues.append(_issue("list_too_long", path, f"At most {max_items} items are allowed.",
                             max_items, len(values)))
    for i, value in enumerate(values):
        text = (value or "").strip() if isinstance(value, str) else ""
        if not text:
            issues.append(_issue("text_required", f"{path}.{i}", "This item is empty."))
        elif len(text) > max_chars:
            issues.append(_issue("text_too_long", f"{path}.{i}",
                                 f"Item is {len(text)} characters; the limit is {max_chars}.",
                                 max_chars, len(text)))
    return issues


def _valid_url(url: str) -> bool:
    if not isinstance(url, str) or len(url) > 2000:
        return False
    parsed = urlparse(url)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def metric_allowed(metric: str, item: ContentItem) -> bool:
    if metric not in formats.Format.values and metric not in _metric_values():
        return False
    if metric == "follower_growth":
        return False
    if metric == "replies" and item.format != "story":
        return False
    if metric == "views" and item.media_kind != "video":
        return False
    return True


def _metric_values():
    from apps.planning.models import Metric

    return Metric.values


def validate_brief(data: dict, item: ContentItem, role: str | None = None) -> list[dict]:
    role = role or data.get("role") or item.role
    issues: list[dict] = []
    for name, (lo, hi, required) in TEXT_LIMITS.items():
        issues += _text_issues(name, data.get(name, ""), lo, hi, required)
    issues += _text_issues("cta", data.get("cta", ""), 1, 120, role == "convert")
    issues += _list_issues("must_include", data.get("must_include"), 6, 120)
    issues += _list_issues("must_avoid", data.get("must_avoid"), 6, 120)
    refs = data.get("references") or []
    if len(refs) > 8:
        issues.append(_issue("list_too_long", "references", "At most 8 references are allowed.",
                             8, len(refs)))
    for i, ref in enumerate(refs):
        ref = ref if isinstance(ref, dict) else {}
        title = (ref.get("title") or "").strip()
        if not title:
            issues.append(_issue("text_required", f"references.{i}.title",
                                 "Reference title is required."))
        elif len(title) > 200:
            issues.append(_issue("text_too_long", f"references.{i}.title",
                                 f"Reference title is {len(title)} characters; the limit is 200.",
                                 200, len(title)))
        if not _valid_url(ref.get("url", "")):
            issues.append(_issue("invalid_url", f"references.{i}.url",
                                 "Reference link must be an http or https URL."))
    metric = data.get("success_metric")
    if not metric or not metric_allowed(metric, item):
        issues.append(_issue("metric_not_allowed", "success_metric",
                             "This success metric is not allowed for this format."))
    issues += _text_issues("feedback", data.get("feedback", ""), 0, 1000, False)
    return issues


def brief_fields(brief: Brief) -> dict:
    return {name: getattr(brief, name) for name in EDITABLE_FIELDS} | {
        "role": brief.role, "feedback": brief.feedback}


def brief_warnings(brief: Brief, item: ContentItem) -> list[dict]:
    warnings = []
    plan_metrics = getattr(item.plan, "success_metrics", None) or []
    if brief.success_metric not in plan_metrics:
        warnings.append({"code": "metric_not_in_plan",
                         "message": "The success metric is not one of the plan's metrics."})
    if not brief.references:
        warnings.append({"code": "no_references",
                         "message": "No references: the facts check has nothing to check "
                                    "claims against."})
    return warnings


def normalise(output: dict) -> dict:
    """Trim strings, drop empty and duplicate list items (rule 14.4)."""
    data = {}
    for key, value in output.items():
        if isinstance(value, str):
            data[key] = value.strip()
        elif isinstance(value, list) and all(isinstance(v, str) for v in value):
            seen, items = set(), []
            for v in value:
                v = v.strip()
                if v and v.casefold() not in seen:
                    seen.add(v.casefold())
                    items.append(v)
            data[key] = items
        else:
            data[key] = value
    return data


# --- Guards --------------------------------------------------------------------------------

def ensure_writable(item: ContentItem) -> None:
    """Rules 9-11."""
    if item.status not in WRITABLE_STATUSES:
        reason = "terminal" if item.status in TERMINAL else "production_started"
        raise InvalidTransition({"status": item.status, "reason": reason})
    pipeline.ensure_idle(item)
    if not formats.is_allowed(item.format, item.media_kind, item.production_mode):
        raise InvalidTransition({"status": item.status, "reason": "format_not_set"})


def latest_brief(item: ContentItem) -> Brief | None:
    return Brief.objects.filter(content_item=item).order_by("-version").first()


def approved_brief(item: ContentItem) -> Brief | None:
    return Brief.objects.filter(content_item=item, status=DocumentStatus.APPROVED).first()


def latest_version(item: ContentItem) -> int:
    return Brief.objects.filter(content_item=item).aggregate(v=Max("version"))["v"] or 0


def check_base_version(item: ContentItem, base_version) -> None:
    if base_version is None:
        return
    latest = latest_brief(item)
    current = latest.version if latest else 0
    if int(base_version) != current:
        details = {"latest_version": current}
        if latest is not None:
            details["latest_origin"] = latest.origin
            details["latest_created_by"] = _user_ref(latest.created_by)
        raise _version_conflict(details)


def _user_ref(user):
    from apps.core.jobs import user_ref

    return user_ref(user)


def text_provider_ready() -> bool:
    """Checked before a user-started job is created (API.md, Long actions)."""
    try:
        from apps.ai import gateway
    except ImportError:
        return True
    for name in ("is_configured", "provider_configured", "text_configured"):
        fn = getattr(gateway, name, None)
        if callable(fn):
            try:
                return bool(fn("text"))
            except TypeError:
                return bool(fn())
    return True


def ensure_text_provider() -> None:
    if not text_provider_ready():
        from apps.core.errors import ProviderNotConfiguredError

        raise ProviderNotConfiguredError()


# --- Starting jobs ------------------------------------------------------------------------

def start_generate_job(item: ContentItem, *, user=None, request_id=None, feedback: str = "",
                       base_version=None, parent_job_id: str | None = None, check_provider=True):
    from apps.core.jobs import start_job

    if check_provider:
        ensure_text_provider()
    ensure_writable(item)
    check_base_version(item, base_version)
    payload = {"feedback": feedback or "",
               "base_version": latest_version(item) if base_version is None else int(base_version)}
    if parent_job_id:
        payload["parent_job"] = parent_job_id
    job = start_job(JOB_KIND, target_id=item.pk, account=item.account, user=user,
                    request_id=request_id, payload=payload)
    if parent_job_id:
        from apps.core.models import JobRun

        JobRun.objects.filter(pk=job.pk).update(result={"parent_job": parent_job_id})
    pipeline.log_event(item, ContentEvent.Type.JOB_STARTED, message="Brief generation started",
                       data={"job_id": str(job.id), "kind": JOB_KIND})
    return job


# --- The job body (rule 14) ---------------------------------------------------------------

def _plan_payload(plan) -> dict:
    goals = []
    for goal in (plan.goals.all() if hasattr(plan, "goals") else []):
        goals.append({"metric": goal.metric, "scope": goal.scope, "format": goal.format,
                      "target_value": goal.target_value})
    return {"objective": plan.objective, "audience_summary": plan.audience_summary,
            "audience_segments": plan.audience_segments, "success_metrics": plan.success_metrics,
            "goals": goals}


def _slot_payload(item: ContentItem):
    slot = item.slot
    if slot is None:
        return None
    local = slot.scheduled_at.astimezone(ZoneInfo(item.account.timezone))
    return {"weekday": local.strftime("%A"), "local_time": local.strftime("%H:%M"),
            "role": slot.role}


def _format_rules(item: ContentItem) -> dict:
    spec = formats.get_spec(item.format, item.media_kind)
    try:
        rule = formats.script_rules_for(item.format, item.media_kind, item.production_mode)
        duration = rule["duration_seconds"]
    except formats.UnknownFormat:
        duration = {"min": spec.min_duration_s or 0, "max": spec.max_duration_s or 0}
    return {"format_label": spec.label, "duration_seconds": duration,
            "caption_allowed": spec.caption_allowed, "max_hashtags": spec.max_hashtags,
            "safe_area_note": "Keep text and key visuals away from the top and bottom bands, "
                              "which Instagram covers with its own interface."}


def _source_detail(candidate) -> dict | None:
    """Detail of the candidate's source record, when the selection app links one."""
    for attr in ("topic", "feed_item", "repurpose_task"):
        source = getattr(candidate, attr, None)
        if source is None:
            continue
        if attr == "topic":
            return {"kind": "trend", "hooks": getattr(source, "hooks", []),
                    "why_now": getattr(source, "why_now", ""),
                    "keywords": getattr(source, "keywords", [])}
        if attr == "feed_item":
            published = getattr(source, "published_at", None)
            return {"kind": "feed_item", "title": source.title,
                    "summary": getattr(source, "summary", ""), "url": getattr(source, "url", ""),
                    "published_at": published.isoformat() if published else None}
        return {"kind": "repurpose", "reason": getattr(source, "reason", ""),
                "suggested_angle": getattr(source, "suggested_angle", "")}
    return None


def build_variables(item: ContentItem, *, feedback: str, previous: Brief | None) -> dict:
    candidate = item.candidate
    role_payload = None
    all_roles = None
    role_key = item.role or candidate.suggested_role
    if role_key:
        role = roles.get_role(role_key)
        role_payload = {"key": role.key, "label": role.label, "purpose": role.purpose,
                        "guidance": role.guidance}
    else:
        all_roles = [{"key": r.key, "label": r.label, "purpose": r.purpose,
                      "guidance": r.guidance} for r in roles.ROLES]
    week_items = []
    for other in ContentItem.objects.filter(plan_id=item.plan_id, current_brief__isnull=False
                                            ).exclude(pk=item.pk).select_related(
            "current_brief")[:20]:
        week_items.append({"title": other.title, "format": other.format,
                           "key_message": other.current_brief.key_message})
    return {
        "content_language": item.account.content_language,
        "item": {"title": item.title, "format": item.format, "media_kind": item.media_kind,
                 "production_mode": item.production_mode,
                 "format_label": formats.format_label(item.format, item.media_kind)},
        "role": role_payload,
        "roles": all_roles,
        "slot": _slot_payload(item),
        "plan": _plan_payload(item.plan),
        "candidate": {"kind": candidate.kind, "title": candidate.title,
                      "summary": candidate.summary, "rationale": candidate.rationale,
                      "sources": [{"n": i + 1, "title": s.get("title", ""), "url": s.get("url", "")}
                                  for i, s in enumerate(candidate.sources or [])]},
        "source_detail": _source_detail(candidate),
        "format_rules": _format_rules(item),
        "week_items": week_items,
        "previous": ({**{k: v for k, v in brief_fields(previous).items()
                         if k not in ("references", "success_metric")}, "feedback": feedback}
                     if previous is not None else None),
        "feedback": feedback or "",
        "repair": None,
    }


def generate(item_id: int, *, job, feedback: str = "", base_version: int | None = None,
             progress=None) -> dict:
    """Body of the `brief.generate` job. Returns the job result."""
    from apps.ai.gateway import run_text

    item = ContentItem.objects.select_related("account", "plan", "slot", "candidate").get(
        pk=item_id)
    previous = latest_brief(item)
    if base_version is not None and (previous.version if previous else 0) != base_version:
        from apps.core.jobs import JobError

        raise JobError("version_conflict", "A newer brief appeared while this one was written.")

    role_given = item.role or item.candidate.suggested_role
    variables = build_variables(item, feedback=feedback, previous=previous)
    progress and progress(20, "Writing brief")
    result = run_text(JOB_KIND, variables=variables, schema=_schema(), account_id=item.account_id,
                      job_id=job.id)
    data = normalise(result.data.model_dump(mode="json"))
    ai_run_id = result.ai_run_id
    role = role_given or data.get("role")
    if role_given and data.get("role") != role_given:
        progress and progress(50, "Role from the model replaced with the item's role")
    data["role"] = role
    data.update(_code_fields(item, role, previous))
    issues = validate_brief(data, item, role)
    repaired = False
    if issues:
        progress and progress(70, "Fixing rule problems")
        variables["repair"] = {"output": {k: v for k, v in data.items()
                                          if k not in ("references", "success_metric")},
                               "issues": issues}
        result = run_text(JOB_KIND, variables=variables, schema=_schema(),
                          account_id=item.account_id, job_id=job.id)
        repaired = True
        data = normalise(result.data.model_dump(mode="json"))
        ai_run_id = result.ai_run_id
        data["role"] = role
        data.update(_code_fields(item, role, previous))
        issues = validate_brief(data, item, role)

    valid = not issues
    with transaction.atomic():
        item = pipeline.lock(item)
        current = latest_version(item)
        if current != (previous.version if previous else 0):
            from apps.core.jobs import JobError

            raise JobError("version_conflict", "A newer brief appeared while this one was written.")
        if item.role is None and role:
            pipeline.log_event(item, ContentEvent.Type.EDITED,
                               message=f"Role set to {roles.label(role)}",
                               data={"changes": {"role": [None, role]},
                                     "source": "brief.generate"})
            item.role = role
            item.save(update_fields=["role", "updated_at"])
        brief = _store(item, data, origin=Origin.AI, feedback=feedback, ai_run_id=ai_run_id,
                       user=None, valid=valid)
        auto = valid and _auto_approve_applies(item)
        if auto:
            approve(item, brief.version, user=None, auto=True)
        else:
            pipeline.set_hold_reason(item, HOLD_WAITING if valid else HOLD_INVALID)
    progress and progress(95, "Brief ready")
    return {"brief_version": brief.version, "valid": valid, "issues": len(issues),
            "repaired": repaired, "auto_approved": auto}


def _schema():
    from .ai_schemas import output_schema

    return output_schema(JOB_KIND)


def _code_fields(item: ContentItem, role: str, previous: Brief | None) -> dict:
    """References and the success metric are set in code (rules 7-8)."""
    if previous is not None:
        references = previous.references
        metric = previous.success_metric if metric_allowed(previous.success_metric, item) else (
            roles.default_metric(role, item.format))
    else:
        references = [{"title": (s.get("title") or s.get("url") or "")[:200], "url": s.get("url")}
                      for s in (item.candidate.sources or [])[:8] if s.get("url")]
        metric = roles.default_metric(role, item.format)
    return {"references": references, "success_metric": metric}


def _store(item, data, *, origin, feedback, ai_run_id, user, valid) -> Brief:
    version = latest_version(item) + 1
    Brief.objects.filter(content_item=item, status=DocumentStatus.DRAFT).update(
        status=DocumentStatus.SUPERSEDED)
    brief = Brief.objects.create(
        content_item=item, version=version, role=data["role"],
        objective=data.get("objective", ""), key_message=data.get("key_message", ""),
        hook_direction=data.get("hook_direction", ""), audience_note=data.get("audience_note", ""),
        cta=data.get("cta", ""), must_include=data.get("must_include", []),
        must_avoid=data.get("must_avoid", []), references=data.get("references", []),
        format_notes=data.get("format_notes", ""), success_metric=data["success_metric"],
        feedback=feedback or "", status=DocumentStatus.DRAFT, origin=origin,
        ai_run_id=ai_run_id, created_by=user,
    )
    item.current_brief = brief
    item.save(update_fields=["current_brief", "updated_at"])
    verb = "written" if origin == Origin.AI else "saved"
    pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user,
                       message=f"Brief v{version} {verb}",
                       data={"brief_id": brief.pk, "version": version, "origin": origin,
                             "valid": valid})
    return brief


def _auto_approve_applies(item: ContentItem) -> bool:
    """Rule 25."""
    autopilot = item.account.autopilot or {}
    return bool(autopilot.get("brief")) and item.status == S.SELECTED and (
        approved_brief(item) is None)


def on_job_failed(item_id: int, job, error_code: str) -> None:
    """Rule 17: hold reason after a failed generation."""
    item = ContentItem.objects.filter(pk=item_id).first()
    if item is None:
        return
    pipeline.set_hold_reason(
        item, f"Brief could not be written ({error_code}). Try again or write it by hand.")


# --- Editing (rules 28-32) ----------------------------------------------------------------

def save_edit(item: ContentItem, data: dict, *, user) -> Brief:
    with transaction.atomic():
        item = pipeline.lock(item)
        ensure_writable(item)
        base_version = data.get("base_version")
        if base_version is None:
            raise DetailedValidationError({"base_version": [ErrorDetail("required",
                                                                        code="required")]})
        check_base_version(item, base_version)
        if not item.role:
            raise DetailedValidationError({"role": [ErrorDetail("role_required",
                                                                code="role_required")]})
        fields = {name: data.get(name) for name in EDITABLE_FIELDS}
        for name in ("must_include", "must_avoid", "references"):
            fields[name] = fields[name] or []
        for name in ("objective", "key_message", "hook_direction", "audience_note", "cta",
                     "format_notes"):
            fields[name] = (fields[name] or "").strip()
        fields["must_include"] = [str(v).strip() for v in fields["must_include"]]
        fields["must_avoid"] = [str(v).strip() for v in fields["must_avoid"]]
        fields["references"] = [{"title": (r.get("title") or "").strip(),
                                 "url": (r.get("url") or "").strip()}
                                for r in fields["references"] if isinstance(r, dict)]
        note = (data.get("note") or "").strip()
        fields["feedback"] = note
        fields["role"] = item.role
        issues = validate_brief(fields, item, item.role)
        if issues:
            raise DetailedValidationError(
                _issues_to_fields(issues), details={"issues": issues})
        brief = _store(item, fields, origin=Origin.HUMAN, feedback=note, ai_run_id=None,
                       user=user, valid=True)
        pipeline.set_hold_reason(item, HOLD_WAITING)
    return brief


def _issues_to_fields(issues: list[dict]) -> dict:
    """Turn issues into the nested structure the shared error handler flattens to paths."""
    out: dict = {}
    for issue in issues:
        out.setdefault(issue["path"], []).append(ErrorDetail(issue["message"], code=issue["code"]))
    return out


# --- Approving (rules 21-24) --------------------------------------------------------------

def approve(item: ContentItem, version: int, *, user=None, auto: bool = False) -> ContentItem:
    with transaction.atomic():
        item = pipeline.lock(item)
        if not auto:
            ensure_writable(item)
        latest = latest_brief(item)
        if latest is None or latest.version != int(version):
            raise _version_conflict({"latest_version": latest.version if latest else 0})
        if latest.status == DocumentStatus.APPROVED:
            return item
        if latest.status == DocumentStatus.SUPERSEDED:
            raise InvalidTransition({"status": item.status, "reason": "brief_superseded"})
        issues = validate_brief(brief_fields(latest), item, latest.role)
        if issues:
            raise InvalidTransition({"status": item.status, "reason": "brief_invalid",
                                     "issues": issues})
        Brief.objects.filter(content_item=item, status=DocumentStatus.APPROVED).update(
            status=DocumentStatus.SUPERSEDED)
        latest.status = DocumentStatus.APPROVED
        latest.save(update_fields=["status", "updated_at"])
        pipeline.set_hold_reason(item, "")
        pipeline.log_event(item, ContentEvent.Type.EDITED, actor=user,
                           message=f"Brief v{latest.version} approved",
                           data={"brief_id": latest.pk, "version": latest.version, "auto": auto})
        if item.status == S.SELECTED:
            pipeline.transition(item, S.BRIEFED, actor=user,
                                message=f"Brief v{latest.version} approved")
        elif item.status == S.SCRIPTED:
            ScriptVersion.objects.filter(content_item=item, status__in=[
                DocumentStatus.APPROVED, DocumentStatus.DRAFT]).update(
                status=DocumentStatus.SUPERSEDED)
            pipeline.transition(item, S.BRIEFED, actor=user,
                                message=f"Script replaced after brief v{latest.version} was "
                                        "approved")
    return item


# --- Batch (rules 18-20) ------------------------------------------------------------------

def eligibility(item: ContentItem, plan_id: int, regenerate_drafts: bool) -> str | None:
    if item.plan_id != plan_id:
        return "not_in_plan"
    if item.status != S.SELECTED:
        return "wrong_status"
    if approved_brief(item) is not None:
        return "has_approved_brief"
    if pipeline.active_job(item) is not None:
        return "job_running"
    latest = latest_brief(item)
    if latest is not None and latest.status == DocumentStatus.DRAFT and not regenerate_drafts:
        return "has_draft"
    return None


def start_batch(plan, *, content_items=None, regenerate_drafts=False, user=None,
                request_id=None):
    from apps.core.errors import JobInProgress
    from apps.core.jobs import active_job_for, start_job
    from apps.core.models import JobRun

    if plan.status != "active":
        raise InvalidTransition({"status": plan.status})
    if content_items is not None and len(content_items) > BATCH_MAX_ITEMS:
        raise DetailedValidationError({"content_items": [ErrorDetail("max_length",
                                                                     code="max_length")]})
    ensure_text_provider()
    existing = active_job_for("plan", plan.pk, [BATCH_KIND])
    if existing is not None:
        raise JobInProgress(existing)
    if content_items is None:
        candidates = list(ContentItem.objects.filter(plan=plan).exclude(
            status=S.CANCELLED).order_by("pk")[:200])
    else:
        found = {i.pk: i for i in ContentItem.objects.filter(pk__in=content_items,
                                                              account=plan.account)}
        candidates = [found.get(pk) or pk for pk in content_items]
    eligible, skipped = [], []
    for item in candidates:
        if not isinstance(item, ContentItem):
            skipped.append({"content_item": item, "reason": "not_in_plan"})
            continue
        reason = eligibility(item, plan.pk, regenerate_drafts)
        if reason is None:
            eligible.append(item)
        elif content_items is not None:
            skipped.append({"content_item": item.pk, "reason": reason})
    eligible = eligible[:BATCH_MAX_ITEMS]
    if not eligible:
        raise DetailedValidationError(
            {"content_items": [ErrorDetail("nothing_to_do", code="nothing_to_do")]},
            details={"skipped": skipped})
    with transaction.atomic():
        parent = start_job(BATCH_KIND, target_id=plan.pk, account=plan.account, user=user,
                           request_id=request_id, payload={}, enqueue=False) if (
            _start_job_accepts_enqueue()) else start_job(
            BATCH_KIND, target_id=plan.pk, account=plan.account, user=user,
            request_id=request_id, payload={})
        result = {"total": len(eligible), "done": 0, "created": 0, "failed": 0,
                  "skipped": skipped, "items": []}
        from datetime import timedelta

        from apps.core.jobs import timeout_for

        now = timezone.now()
        JobRun.objects.filter(pk=parent.pk).update(
            status=JobRun.Status.RUNNING, started_at=now, result=result,
            deadline_at=now + timedelta(seconds=timeout_for(BATCH_KIND)),
            message=f"0 of {len(eligible)} briefs written")
        for item in eligible:
            start_generate_job(item, user=user, request_id=request_id,
                               parent_job_id=str(parent.id), check_provider=False)
    parent.refresh_from_db()
    return parent


def _start_job_accepts_enqueue() -> bool:
    import inspect

    from apps.core.jobs import start_job

    try:
        return "enqueue" in inspect.signature(start_job).parameters
    except (TypeError, ValueError):
        return False


def update_batch_parent(sender=None, job=None, **kwargs) -> None:
    """`job_finished` receiver: count a finished child into its batch parent (rule 20)."""
    if job is None or job.kind != JOB_KIND:
        return
    parent_id = (job.result or {}).get("parent_job")
    if not parent_id:
        return
    from apps.core.models import JobRun

    with transaction.atomic():
        parent = JobRun.objects.select_for_update().filter(pk=parent_id).first()
        if parent is None or parent.status not in JobRun.ACTIVE_STATUSES:
            return
        result = dict(parent.result or {})
        items = list(result.get("items", []))
        if any(entry.get("job") == str(job.id) for entry in items):
            return
        child = job.result or {}
        succeeded = job.status == JobRun.Status.SUCCEEDED
        items.append({"content_item": int(job.target_id), "job": str(job.id),
                      "status": job.status, "brief_version": child.get("brief_version"),
                      "auto_approved": bool(child.get("auto_approved")),
                      "error_code": job.error_code})
        result["items"] = items
        result["done"] = len(items)
        result["created"] = sum(1 for e in items if e["status"] == JobRun.Status.SUCCEEDED)
        result["failed"] = result["done"] - result["created"]
        total = max(int(result.get("total", 1)), 1)
        parent.result = result
        parent.progress = round(result["done"] / total * 100)
        parent.message = f"{result['done']} of {total} briefs written"
        fields = ["result", "progress", "message", "updated_at"]
        if result["done"] >= total:
            parent.finished_at = timezone.now()
            if result["created"] == 0:
                parent.status = JobRun.Status.FAILED
                parent.error_code = "all_failed"
                parent.error_detail = "No brief could be written."
                fields += ["error_code", "error_detail"]
            else:
                parent.status = JobRun.Status.SUCCEEDED
            fields += ["status", "finished_at"]
        parent.save(update_fields=fields)
    if not succeeded and job.error_code:
        on_job_failed(int(job.target_id), job, job.error_code)


# --- Pipeline handler (rule 26) and actions (rule 33) -------------------------------------

def handle_selected(item: ContentItem) -> None:
    if pipeline.active_job(item) is not None:
        return
    latest = latest_brief(item)
    if latest is not None and latest.status != DocumentStatus.SUPERSEDED:
        return
    if not formats.is_allowed(item.format, item.media_kind, item.production_mode):
        return
    start_generate_job(item, check_provider=False)


pipeline.register_handler(S.SELECTED, handle_selected)


def brief_actions(item: ContentItem) -> dict:
    can_write = item.status in WRITABLE_STATUSES and pipeline.active_job(item) is None and (
        formats.is_allowed(item.format, item.media_kind, item.production_mode))
    latest = latest_brief(item)
    can_approve = bool(can_write and latest is not None and latest.status == DocumentStatus.DRAFT
                       and not validate_brief(brief_fields(latest), item, latest.role))
    return {"can_generate": can_write, "can_edit": can_write, "can_approve": can_approve}


@actions.register
def _brief_item_actions(item, user, ctx):
    flags = brief_actions(item)
    names = []
    if flags["can_generate"]:
        names += ["generate_brief", "edit_brief"]
    if flags["can_approve"]:
        names.append("approve_brief")
    return names
