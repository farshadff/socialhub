"""Research runs: start, collect, deduplicate, synthesize (E02-S02, E02-S04 wiring)."""

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.accounts.models import InstagramAccount
from apps.core.models import JobRun

from ..collectors.base import CollectContext, CollectorError, SignalDraft
from ..collectors.rss import RSSCollector
from ..collectors.web_search import WebSearchCollector
from ..models import ResearchRun, ResearchSource, SourceKind, TrendSignal
from . import platform, sources as source_rules
from .fingerprints import InvalidURL, fingerprint
from .synthesis import synthesize
from .text import clean, cut

logger = logging.getLogger(__name__)

JOB_KIND = "research.run"
STALE_AFTER = timedelta(minutes=30)
TEXT_LIMITS = {"title": 300, "excerpt": 1000, "author": 120, "url": 2000}
COLLECT_PROGRESS_END = 70
SYNTH_PROGRESS = 75
SOURCE_ORDER = {SourceKind.WEB_SEARCH: 0, SourceKind.RSS: 1}


def collectors() -> dict:
    """Collector per source kind. Tests replace entries to stub providers."""
    return {SourceKind.WEB_SEARCH: WebSearchCollector(), SourceKind.RSS: RSSCollector()}


# --- Starting -----------------------------------------------------------------------------------


def _finish_job(job: JobRun | None, code: str, detail: str) -> None:
    if job is not None and not job.is_terminal:
        platform.JobContext(job).fail(code, detail)


def recover_stale_runs(account, now=None) -> None:
    """Rule 3: a `running` run whose job ended, or that started over 30 minutes ago, fails."""
    now = now or timezone.now()
    for run in ResearchRun.objects.select_related("job").filter(
        account=account, status=ResearchRun.Status.RUNNING
    ):
        job = run.job
        if (job is not None and not job.is_terminal) and run.started_at > now - STALE_AFTER:
            continue
        run.status = ResearchRun.Status.FAILED
        run.finished_at = now
        run.save(update_fields=["status", "finished_at", "updated_at"])
        _finish_job(job, "stale_run", "The run stopped unexpectedly.")


def start_run(account: InstagramAccount, *, plan, params: dict, user=None,
              request_id: str | None = None) -> ResearchRun:
    """Create a run and its job (rules 1-3, 8). Raises `JobInProgress` when one is running."""
    with transaction.atomic():
        InstagramAccount.objects.select_for_update().get(pk=account.pk)
        recover_stale_runs(account)
        active = (ResearchRun.objects.select_related("job")
                  .filter(account=account, status=ResearchRun.Status.RUNNING).first())
        if active is not None:
            raise platform.JobInProgress(active.job)
        try:
            with transaction.atomic():
                run = ResearchRun.objects.create(
                    account=account, plan=plan, status=ResearchRun.Status.RUNNING,
                    params=params, stats={}, started_at=timezone.now(), started_by=user,
                )
        except IntegrityError:
            active = (ResearchRun.objects.select_related("job")
                      .filter(account=account, status=ResearchRun.Status.RUNNING).first())
            if active is None:
                raise
            raise platform.JobInProgress(active.job) from None
        job = platform.start_job(JOB_KIND, target_id=run.pk, account=account, user=user,
                                 request_id=request_id)
        run.job = job
        run.save(update_fields=["job", "updated_at"])
    return run


# --- Saving drafts ------------------------------------------------------------------------------


@dataclass
class SaveResult:
    signals: int = 0
    duplicates: int = 0


def prepare(draft: SignalDraft, *, lookback_days: int, now) -> SignalDraft | None:
    """Rules 13-14: clean and cut text, drop empty titles and drafts older than the window."""
    title = cut(clean(draft.title), TEXT_LIMITS["title"])
    if not title:
        return None
    if draft.published_at and draft.published_at < now - timedelta(days=lookback_days):
        return None
    draft.title = title
    draft.excerpt = cut(clean(draft.excerpt), TEXT_LIMITS["excerpt"])
    draft.author = cut(clean(draft.author), TEXT_LIMITS["author"])
    draft.url = (draft.url or "").strip()[: TEXT_LIMITS["url"]]
    return draft


def save_drafts(run: ResearchRun, source: ResearchSource | None, drafts: list[SignalDraft], *,
                max_signals: int, lookback_days: int, now, seen: set[str]) -> SaveResult:
    """Normalize, cap, deduplicate and store drafts (rules 12-19)."""
    result = SaveResult()
    prepared = [d for d in (prepare(d, lookback_days=lookback_days, now=now) for d in drafts) if d]
    for draft in prepared[:max_signals]:
        try:
            fp = fingerprint(draft.kind, draft.url, draft.author, draft.excerpt)
        except InvalidURL:
            continue
        if fp in seen:
            result.duplicates += 1
            continue
        seen.add(fp)
        existing = TrendSignal.objects.filter(account_id=run.account_id, fingerprint=fp).first()
        if existing is None:
            try:
                with transaction.atomic():
                    TrendSignal.objects.create(
                        account_id=run.account_id, run=run, source=source, kind=draft.kind,
                        url=draft.url, title=draft.title, excerpt=draft.excerpt,
                        author=draft.author, published_at=draft.published_at, captured_at=now,
                        metrics=draft.metrics or {}, fingerprint=fp, raw=draft.raw or {},
                    )
                result.signals += 1
                continue
            except IntegrityError:
                existing = TrendSignal.objects.get(account_id=run.account_id, fingerprint=fp)
        if draft.metrics:
            existing.metrics = draft.metrics
            existing.save(update_fields=["metrics", "updated_at"])
        result.duplicates += 1
    return result


# --- Executing ----------------------------------------------------------------------------------


def _ordered_sources(run: ResearchRun) -> list[ResearchSource]:
    qs = ResearchSource.objects.filter(account_id=run.account_id, active=True)
    if ids := run.params.get("source_ids"):
        qs = qs.filter(pk__in=ids)
    return sorted(qs, key=lambda s: (SOURCE_ORDER.get(s.kind, 9), s.pk))


def _finish(run: ResearchRun, status: str, stats: dict) -> None:
    run.status = status
    run.stats = stats
    run.finished_at = timezone.now()
    run.save(update_fields=["status", "stats", "finished_at", "updated_at"])


def collect(run: ResearchRun, ctx, stats: dict) -> bool:
    """Visit every source. Returns False when every attempted source failed (rule 23)."""
    sources = _ordered_sources(run)
    collector_map = collectors()
    lookback = int(run.params.get("lookback_days", 7))
    account = run.account
    brand = getattr(account, "brand", None)
    seen: set[str] = set()
    failures = 0
    for index, source in enumerate(sources, start=1):
        label = source.label or source.value
        ctx.progress(round(COLLECT_PROGRESS_END * (index - 1) / len(sources)),
                     f"Collecting {label} ({index} of {len(sources)})")
        now = timezone.now()
        collected = SaveResult()
        available, reason = source_rules.availability(source.kind)
        if not available:
            status = f"error:{reason}"
        else:
            collector = collector_map[source.kind]
            context = CollectContext(account=account, plan=run.plan, brand=brand,
                                     lookback_days=lookback, job_id=run.job_id, now=now)
            try:
                drafts = collector.collect(source, context)
                collected = save_drafts(run, source, drafts, max_signals=collector.max_signals,
                                        lookback_days=lookback, now=now, seen=seen)
                status = "ok" if collected.signals else "empty"
            except CollectorError as exc:
                status = f"error:{exc.code}"
            except Exception:  # noqa: BLE001 - one broken source never fails the run
                logger.exception("research source %s failed", source.pk)
                status = "error:provider_error"
        if status.startswith("error:"):
            failures += 1
        ResearchSource.objects.filter(pk=source.pk).update(
            last_run_at=now, last_status=status, updated_at=now)
        stats["by_source"][str(source.pk)] = {"signals": collected.signals,
                                              "duplicates": collected.duplicates,
                                              "status": status}
        stats["signals"] += collected.signals
        stats["duplicates"] += collected.duplicates
    ctx.progress(COLLECT_PROGRESS_END)
    return not sources or failures < len(sources)


def execute_run(run_id: int, ctx) -> None:
    """The body of the `research.run` job."""
    run = ResearchRun.objects.select_related("account", "plan").get(pk=run_id)
    if run.status != ResearchRun.Status.RUNNING:
        return  # re-delivered after the run already ended
    stats = {"signals": 0, "duplicates": 0, "topics": 0, "dropped_topics": 0,
             "synthesis": "skipped", "by_source": {}}

    if run.params.get("collect", True) and not collect(run, ctx, stats):
        _finish(run, ResearchRun.Status.FAILED, stats)
        ctx.fail("all_sources_failed", "No source could be read.")
        return

    message = "Done"
    if run.params.get("synthesize", True):
        ctx.progress(SYNTH_PROGRESS, "Grouping signals into topics")
        try:
            outcome = synthesize(run, job_id=run.job_id)
        except platform.AIError as exc:
            _finish(run, ResearchRun.Status.FAILED, stats)
            ctx.fail(getattr(exc, "code", "provider_error"), getattr(exc, "detail", "") or "")
            return
        stats.update(synthesis=outcome.synthesis, topics=outcome.topics,
                     dropped_topics=outcome.dropped_topics)
        if outcome.synthesis == "skipped_too_few_signals":
            message = "Not enough signals to form topics yet."

    _finish(run, ResearchRun.Status.COMPLETED, stats)
    ctx.succeed({"run_id": run.pk, "signals": stats["signals"],
                 "duplicates": stats["duplicates"], "topics": stats["topics"]}, message=message)
    transaction.on_commit(lambda: request_ranking(run))


def fail_on_timeout(run_id: int) -> None:  # also used for crashes
    """Soft time limit: the run fails, signals saved so far are kept."""
    ResearchRun.objects.filter(pk=run_id, status=ResearchRun.Status.RUNNING).update(
        status=ResearchRun.Status.FAILED, finished_at=timezone.now(), updated_at=timezone.now())


def request_ranking(run: ResearchRun) -> None:
    """Rule 27: with autopilot selection on, ask E03-S02 to rank the plan. Never fails the run."""
    plan = run.plan
    if plan is None or plan.status != "active":
        return
    if not (run.account.autopilot or {}).get("selection"):
        return
    try:
        from apps.selection.services.ranking import request_rank
    except ImportError:
        logger.info("Ranking not available yet (E03-S02); research run %s", run.pk)
        return
    try:
        request_rank(plan, reason="research_completed")
    except Exception:  # noqa: BLE001
        logger.exception("Requesting ranking after research run %s failed", run.pk)
