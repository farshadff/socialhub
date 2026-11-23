"""Research runs: start, execute, save signals (E02-S02)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.db import IntegrityError, transaction

from apps.accounts.models import InstagramAccount
from apps.core import clock
from apps.core.exceptions import ProviderNotConfiguredError
from apps.core.jobs import JobContext, JobInProgress, fail_job, start_job
from apps.core.models import JobRun
from apps.planning.models import WeeklyPlan

from ..collectors.base import CollectorContext, CollectorError, SignalDraft
from ..collectors.rss import RSSCollector
from ..collectors.web_search import WebSearchCollector
from ..models import ResearchRun, ResearchSource, SourceKind, TrendSignal
from . import sources as source_rules
from .fingerprints import InvalidURL, fingerprint
from .text import clean_cut

logger = logging.getLogger(__name__)

JOB_KIND = "research.run"
STALE_AFTER = timedelta(minutes=30)
COLLECT_PROGRESS_END = 70
SOURCE_ORDER = (SourceKind.WEB_SEARCH.value, SourceKind.RSS.value)
TEXT_LIMITS = {"title": 300, "excerpt": 1000, "author": 120}
URL_LIMIT = 2000

COLLECTORS = {
    SourceKind.WEB_SEARCH.value: WebSearchCollector(),
    SourceKind.RSS.value: RSSCollector(),
}


# --- Plan default -------------------------------------------------------------------------------


def default_plan(account: InstagramAccount) -> WeeklyPlan | None:
    """The earliest draft or active plan whose week has not ended (rule 5)."""
    today = clock.now().astimezone(account.tz).date()
    return (
        WeeklyPlan.objects.filter(
            account=account,
            status__in=[WeeklyPlan.Status.DRAFT, WeeklyPlan.Status.ACTIVE],
            week_end__gte=today,
        )
        .order_by("week_start")
        .first()
    )


# --- Starting -----------------------------------------------------------------------------------


@dataclass
class RunRequest:
    account: InstagramAccount
    plan: WeeklyPlan | None
    source_ids: list[int] | None
    lookback_days: int = 7
    collect: bool = True
    synthesize: bool = True

    def params(self) -> dict:
        return {
            "lookback_days": self.lookback_days,
            "source_ids": self.source_ids,
            "collect": self.collect,
            "synthesize": self.synthesize,
        }


def recover_stale_runs(account_id: int) -> int:
    """Fail running runs whose job is finished or that started more than 30 minutes ago (rule 3)."""
    cutoff = clock.now() - STALE_AFTER
    recovered = 0
    for run in ResearchRun.objects.select_related("job").filter(
        account_id=account_id, status=ResearchRun.Status.RUNNING
    ):
        job_done = run.job.status in JobRun.TERMINAL_STATUSES
        if not job_done and run.started_at >= cutoff:
            continue
        if not job_done:
            fail_job(run.job, "stale_run", "The research run stopped responding.")
        run.status = ResearchRun.Status.FAILED
        run.finished_at = clock.now()
        run.save(update_fields=["status", "finished_at", "updated_at"])
        recovered += 1
    return recovered


def running_run(account_id: int) -> ResearchRun | None:
    return (
        ResearchRun.objects.select_related("job", "job__created_by")
        .filter(account_id=account_id, status=ResearchRun.Status.RUNNING)
        .first()
    )


def start_run(request: RunRequest, *, user=None, request_id: str | None = None) -> JobRun:
    """Create a run and its ``research.run`` job (rules 1–8). Raises ``JobInProgress`` or 503."""
    if request.synthesize:
        from apps.ai.gateway import text_provider_configured

        if not text_provider_configured():
            raise ProviderNotConfiguredError()

    with transaction.atomic():
        # Lock the account row so the check-and-insert below is serialised per account.
        InstagramAccount.objects.select_for_update().get(pk=request.account.pk)
        recover_stale_runs(request.account.pk)
        active = running_run(request.account.pk)
        if active is not None:
            raise JobInProgress(active.job)
        job_id = uuid.uuid4()
        run = ResearchRun.objects.create(
            account=request.account,
            plan=request.plan,
            job_id=job_id,
            status=ResearchRun.Status.RUNNING,
            params=request.params(),
            stats={},
            started_at=clock.now(),
        )
        return start_job(
            JOB_KIND,
            target_id=run.pk,
            account=request.account,
            user=user,
            request_id=request_id,
            job_id=job_id,
        )


# --- Saving signals ------------------------------------------------------------------------------


@dataclass
class SaveOutcome:
    signals: int = 0
    duplicates: int = 0


def prepare(draft: SignalDraft) -> SignalDraft | None:
    """Apply the text limits of rule 13. Returns None for a draft that must be dropped."""
    draft.title = clean_cut(draft.title, TEXT_LIMITS["title"])
    draft.excerpt = clean_cut(draft.excerpt, TEXT_LIMITS["excerpt"])
    draft.author = clean_cut(draft.author, TEXT_LIMITS["author"])
    draft.url = (draft.url or "").strip()
    if not draft.title:
        return None
    # A cut URL would no longer open, so an over-long link drops the draft instead.
    if len(draft.url) > URL_LIMIT:
        return None
    return draft


def save_drafts(
    run: ResearchRun | None,
    source: ResearchSource | None,
    drafts: list[SignalDraft],
    *,
    lookback_days: int,
    seen: set[str] | None = None,
) -> SaveOutcome:
    """Normalise, filter by age, deduplicate and save (rules 13–19)."""
    now = clock.now()
    cutoff = now - timedelta(days=lookback_days)
    seen = seen if seen is not None else set()
    outcome = SaveOutcome()
    account_id = run.account_id if run is not None else source.account_id
    for raw_draft in drafts:
        draft = prepare(raw_draft)
        if draft is None:
            continue
        if draft.published_at is not None and draft.published_at < cutoff:
            continue
        try:
            print_ = fingerprint(draft.kind, draft.url, draft.author, draft.excerpt)
        except InvalidURL:
            continue
        if print_ in seen:
            outcome.duplicates += 1
            continue
        seen.add(print_)
        existing = TrendSignal.objects.filter(account_id=account_id, fingerprint=print_).first()
        if existing is not None:
            if draft.metrics:
                existing.metrics = draft.metrics
                existing.save(update_fields=["metrics", "updated_at"])
            outcome.duplicates += 1
            continue
        try:
            with transaction.atomic():
                TrendSignal.objects.create(
                    account_id=account_id,
                    run=run,
                    source=source,
                    kind=draft.kind,
                    url=draft.url,
                    title=draft.title,
                    excerpt=draft.excerpt,
                    author=draft.author,
                    published_at=draft.published_at,
                    captured_at=now,
                    metrics=draft.metrics or {},
                    fingerprint=print_,
                    raw=draft.raw or {},
                )
        except IntegrityError:
            # Saved concurrently (a manual signal with the same link): count it as a duplicate.
            outcome.duplicates += 1
            continue
        outcome.signals += 1
    return outcome


# --- Executing ------------------------------------------------------------------------------------


def _sources_for(run: ResearchRun) -> list[ResearchSource]:
    queryset = ResearchSource.objects.filter(account_id=run.account_id, active=True)
    source_ids = run.params.get("source_ids")
    if source_ids:
        queryset = queryset.filter(pk__in=source_ids)
    sources = list(queryset)
    sources.sort(
        key=lambda s: (SOURCE_ORDER.index(s.kind) if s.kind in SOURCE_ORDER else 99, s.pk)
    )
    return sources


def _collect_one(source: ResearchSource, ctx: CollectorContext) -> list[SignalDraft]:
    available = source_rules.availability(source.kind)
    if not available.available:
        raise CollectorError(available.reason or "not_supported")
    collector = COLLECTORS.get(source.kind)
    if collector is None:
        raise CollectorError("not_supported")
    drafts = collector.collect(source, ctx)
    return drafts[: collector.max_signals]


def _fail_run(run: ResearchRun, stats: dict) -> None:
    run.status = ResearchRun.Status.FAILED
    run.stats = stats
    run.finished_at = clock.now()
    run.save(update_fields=["status", "stats", "finished_at", "updated_at"])


def mark_failed(run_id: int) -> None:
    """Used when the task dies (time limit, crash) so the run does not stay ``running``."""
    ResearchRun.objects.filter(pk=run_id, status=ResearchRun.Status.RUNNING).update(
        status=ResearchRun.Status.FAILED, finished_at=clock.now(), updated_at=clock.now()
    )


def collect(run: ResearchRun, ctx: JobContext, stats: dict) -> bool:
    """Visit each source. Returns False when every attempted source failed (rule 23)."""
    account = run.account
    collector_ctx = CollectorContext(
        account=account,
        plan=run.plan,
        brand=getattr(account, "brand_profile", None),
        lookback_days=int(run.params.get("lookback_days", 7)),
        job_id=run.job_id,
        now=clock.now(),
    )
    sources = _sources_for(run)
    total = len(sources)
    seen: set[str] = set()
    errors = 0
    for index, source in enumerate(sources):
        label = source.label or source.value
        ctx.progress(
            round(COLLECT_PROGRESS_END * index / total) if total else 0,
            f"Collecting {label} ({index + 1} of {total})",
            force=True,
        )
        outcome = SaveOutcome()
        try:
            drafts = _collect_one(source, collector_ctx)
            outcome = save_drafts(
                run, source, drafts, lookback_days=collector_ctx.lookback_days, seen=seen
            )
            status = "ok" if outcome.signals else "empty"
        except CollectorError as exc:
            status = f"error:{exc.code}"
        except Exception:
            logger.exception("research_source_failed run_id=%s source_id=%s", run.pk, source.pk)
            status = "error:invalid_feed" if source.kind == SourceKind.RSS else "error:provider_error"
        if status.startswith("error:"):
            errors += 1
        stats["by_source"][str(source.pk)] = {
            "signals": outcome.signals,
            "duplicates": outcome.duplicates,
            "status": status,
        }
        stats["signals"] += outcome.signals
        stats["duplicates"] += outcome.duplicates
        source.last_run_at = clock.now()
        source.last_status = status
        source.save(update_fields=["last_run_at", "last_status", "updated_at"])
    ctx.progress(COLLECT_PROGRESS_END, "Collection finished", force=True)
    return not (total and errors == total)


def execute_run(run_id: int, ctx: JobContext) -> None:
    from apps.ai.errors import AIError

    from . import synthesis

    run = (
        ResearchRun.objects.select_related("account", "account__brand_profile", "plan", "job")
        .filter(pk=run_id)
        .first()
    )
    # Idempotency: a finished run or a redelivered task for a terminal job does nothing.
    if run is None or run.status != ResearchRun.Status.RUNNING:
        ctx.fail("stale_run", "The research run is no longer running.")
        return

    stats = {
        "signals": 0,
        "duplicates": 0,
        "topics": 0,
        "dropped_topics": 0,
        "synthesis": "skipped",
        "by_source": {},
    }
    params = run.params
    if params.get("collect", True):
        if not collect(run, ctx, stats):
            _fail_run(run, stats)
            ctx.fail("all_sources_failed", "No source could be read.")
            return

    if params.get("synthesize", True):
        ctx.progress(75, "Grouping signals into topics", force=True)
        try:
            outcome = synthesis.synthesize(run)
        except AIError as exc:
            _fail_run(run, stats)
            ctx.fail(exc.code, exc.detail)
            return
        stats["topics"] = outcome.topics
        stats["dropped_topics"] = outcome.dropped
        stats["synthesis"] = outcome.state
        if outcome.state == "skipped_too_few_signals":
            ctx.progress(95, "Not enough signals to form topics yet.", force=True)

    run.status = ResearchRun.Status.COMPLETED
    run.stats = stats
    run.finished_at = clock.now()
    run.save(update_fields=["status", "stats", "finished_at", "updated_at"])
    ctx.progress(100, "Done", force=True)
    ctx.succeed(
        {
            "run_id": run.pk,
            "signals": stats["signals"],
            "duplicates": stats["duplicates"],
            "topics": stats["topics"],
        }
    )
    transaction.on_commit(lambda: request_ranking(run))


def request_ranking(run: ResearchRun) -> None:
    """Rule 27: ask selection to re-rank when autopilot selection is on for an active plan."""
    try:
        plan = run.plan
        if plan is None or plan.status != WeeklyPlan.Status.ACTIVE:
            return
        autopilot = run.account.autopilot or {}
        if not autopilot.get("selection"):
            return
        try:
            from apps.selection.services.ranking import request_rank
        except ImportError:
            return  # selection (E03-S02) is not installed yet
        request_rank(plan, reason="research_completed")
    except Exception:
        logger.exception("research_request_rank_failed run_id=%s", run.pk)
