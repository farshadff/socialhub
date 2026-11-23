/**
 * Development mock for E03-S04 content items (list, detail, cancel, events) until the real
 * `content` API lands. Shares its in-memory state with mock/selection.ts, so confirming a
 * selection creates items here. Delete this file once `/api/v1/content-items/` is served by
 * Django; the panel needs no change.
 */
import type { Request, Response } from 'express';
import {
  addEvent,
  e03Store,
  findCandidate,
  findSlot,
  mockUser,
  releaseForCancel,
  slotRef,
} from './selection';

type Json = Record<string, any>;

const NEEDS_ATTENTION = ['needs_revision', 'in_review', 'failed'];

const PIPELINE_ORDER = [
  'selected',
  'briefed',
  'scripted',
  'in_production',
  'needs_revision',
  'in_check',
  'in_review',
  'approved',
  'scheduled',
  'publishing',
  'failed',
  'published',
  'cancelled',
];

function fail(res: Response, status: number, code: string, details: Json = {}, fields: Json[] = []) {
  res.status(status).json({
    error: { code, message: code, fields, request_id: 'mock-content', retryable: false, details },
  });
}

function needsAttention(item: Json) {
  return NEEDS_ATTENTION.includes(item.status) || (Boolean(item.hold_reason) && !item.active_job);
}

function planRef(planId: number | null, detail = false) {
  if (!planId) return null;
  const slots = e03Store()
    .slots.filter((s) => s.plan === planId)
    .map((s) => s.scheduled_at)
    .sort();
  const start = slots[0]?.slice(0, 10) ?? '2026-11-28';
  const end = slots[slots.length - 1]?.slice(0, 10) ?? start;
  const d = new Date(`${start}T00:00:00Z`);
  const title = `Week of ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  return detail
    ? { id: planId, title, week_start: start, week_end: end, status: 'active' }
    : { id: planId, title, week_start: start };
}

function summary(item: Json) {
  const candidate = findCandidate(item.candidate_id);
  return {
    id: item.id,
    account: item.account,
    title: item.title,
    format: item.format,
    media_kind: item.media_kind,
    production_mode: item.production_mode,
    role: item.role,
    status: item.status,
    hold_reason: item.hold_reason,
    needs_attention: needsAttention(item),
    revision_count: item.revision_count,
    plan: planRef(item.plan_id),
    slot: slotRef(findSlot(item.slot_id)),
    candidate: candidate ? { id: candidate.id, kind: candidate.kind, total_score: candidate.total_score } : null,
    active_job: item.active_job,
    thumbnail_url: item.thumbnail_url,
    publication: item.publication,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function allowedActions(item: Json) {
  const actions: string[] = [];
  if (!['published', 'cancelled', 'publishing'].includes(item.status)) actions.push('cancel');
  if (['selected', 'briefed', 'scripted'].includes(item.status)) actions.push('edit_format');
  return actions;
}

function detail(item: Json) {
  const candidate = findCandidate(item.candidate_id);
  return {
    ...summary(item),
    cancelled_reason: item.cancelled_reason,
    plan: planRef(item.plan_id, true),
    candidate: candidate
      ? {
          id: candidate.id,
          kind: candidate.kind,
          title: candidate.title,
          summary: candidate.summary,
          rationale: candidate.rationale,
          sources: candidate.sources,
          evidence_score: candidate.evidence_score,
          goal_fit_score: candidate.goal_fit_score,
          freshness_score: candidate.freshness_score,
          total_score: candidate.total_score,
          rank: candidate.rank,
        }
      : null,
    current_brief: null,
    current_script: null,
    current_version: null,
    latest_check: null,
    open_review_task: null,
    allowed_actions: allowedActions(item),
    created_by: item.created_by,
  };
}

const list = (value: unknown): string[] =>
  typeof value === 'string' && value ? value.split(',') : [];

function slotTime(item: Json): string | null {
  return findSlot(item.slot_id)?.scheduled_at ?? null;
}

function find(req: Request) {
  return e03Store().contentItems.find((i) => i.id === Number(req.params.id));
}

export default {
  'GET /api/v1/content-items/': (req: Request, res: Response) => {
    const account = Number(req.query.account);
    if (!account) {
      return fail(res, 400, 'validation_error', {}, [{ path: 'account', code: 'required', message: 'Required.' }]);
    }
    const q = req.query;
    let rows = e03Store().contentItems.filter((i) => i.account === account);
    if (q.plan) rows = rows.filter((i) => i.plan_id === Number(q.plan));
    for (const field of ['status', 'format', 'production_mode']) {
      const values = list(q[field]);
      if (values.length) rows = rows.filter((i) => values.includes(i[field]));
    }
    const roles = list(q.role);
    if (roles.length) rows = rows.filter((i) => roles.includes(i.role ?? 'none'));
    if (q.needs_attention) rows = rows.filter((i) => String(needsAttention(i)) === q.needs_attention);
    if (q.has_active_job) rows = rows.filter((i) => String(Boolean(i.active_job)) === q.has_active_job);
    if (q.search) {
      const text = String(q.search).toLowerCase();
      rows = rows.filter((i) => i.title.toLowerCase().includes(text));
    }
    const ordering = String(q.ordering ?? 'slot_time');
    rows = [...rows].sort((a, b) => {
      switch (ordering) {
        case '-updated_at':
          return b.updated_at.localeCompare(a.updated_at);
        case '-created_at':
          return b.created_at.localeCompare(a.created_at);
        case 'status':
          return PIPELINE_ORDER.indexOf(a.status) - PIPELINE_ORDER.indexOf(b.status);
        default: {
          const at = slotTime(a);
          const bt = slotTime(b);
          if (!at || !bt) return at ? -1 : bt ? 1 : a.id - b.id;
          return ordering === '-slot_time' ? bt.localeCompare(at) : at.localeCompare(bt);
        }
      }
    });
    const size = Number(q.page_size ?? 20) || 20;
    const number = Number(q.page ?? 1) || 1;
    res.json({
      count: rows.length,
      next: number * size < rows.length ? `?page=${number + 1}` : null,
      previous: number > 1 ? `?page=${number - 1}` : null,
      results: rows.slice((number - 1) * size, number * size).map(summary),
    });
  },

  'GET /api/v1/content-items/:id/': (req: Request, res: Response) => {
    const item = find(req);
    if (!item) return fail(res, 404, 'not_found');
    res.json(detail(item));
  },

  'POST /api/v1/content-items/:id/cancel/': (req: Request, res: Response) => {
    const item = find(req);
    if (!item) return fail(res, 404, 'not_found');
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 3 || reason.length > 500) {
      return fail(res, 400, 'validation_error', {}, [
        { path: 'reason', code: reason ? (reason.length < 3 ? 'min_length' : 'max_length') : 'required', message: 'Invalid.' },
      ]);
    }
    if (item.status === 'publishing') {
      return fail(res, 409, 'invalid_transition', { status: item.status, reason: 'publishing_in_progress' });
    }
    if (item.status === 'published' || item.status === 'cancelled') {
      return fail(res, 409, 'invalid_transition', { status: item.status, allowed_statuses: [] });
    }
    const from = item.status;
    const slot = releaseForCancel(item, Boolean(req.body?.release_candidate));
    if (item.active_job) {
      addEvent(item.id, {
        type: 'job_failed',
        message: `Cancelled ${item.active_job.kind}`,
        data: { job_id: item.active_job.id, kind: item.active_job.kind, error_code: 'cancelled' },
      });
      item.active_job = null;
    }
    item.status = 'cancelled';
    item.cancelled_reason = reason;
    item.hold_reason = '';
    item.slot_id = null;
    item.updated_at = new Date().toISOString();
    addEvent(item.id, {
      type: 'status_changed',
      from_status: from,
      to_status: 'cancelled',
      actor: mockUser(),
      message: reason,
      data: { released_slot_id: slot?.id ?? null, release_candidate: Boolean(req.body?.release_candidate) },
    });
    res.json(detail(item));
  },

  'GET /api/v1/content-items/:id/events/': (req: Request, res: Response) => {
    const item = find(req);
    if (!item) return fail(res, 404, 'not_found');
    const types = list(req.query.type);
    let rows = e03Store()
      .events.filter((e) => e.item === item.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
    if (types.length) rows = rows.filter((e) => types.includes(e.type));
    const size = Number(req.query.page_size ?? 50) || 50;
    const number = Number(req.query.page ?? 1) || 1;
    res.json({
      count: rows.length,
      next: number * size < rows.length ? `?page=${number + 1}` : null,
      previous: number > 1 ? `?page=${number - 1}` : null,
      results: rows.slice((number - 1) * size, number * size).map(({ item: _item, ...event }) => event),
    });
  },
};
