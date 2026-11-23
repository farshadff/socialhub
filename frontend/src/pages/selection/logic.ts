/**
 * Pure helpers for the selection page (E03-S01, E03-S03). No React, no requests, so they are
 * unit-tested directly.
 */
import type { FeedItem, FeedItemStatus } from '@/services/socialhub/feeds';
import type { Format, Role } from '@/services/socialhub/formats';
import type { PlanSummary } from '@/services/socialhub/plans';
import type {
  CandidateKind,
  Proposal,
  ProposalCandidate,
  ProposalSlot,
} from '@/services/socialhub/selection';

export type TabKey = 'candidates' | 'proposal' | 'feed-items' | 'feed-sources';
export const TAB_KEYS: TabKey[] = [
  'candidates',
  'proposal',
  'feed-items',
  'feed-sources',
];

export const KIND_LABEL: Record<CandidateKind, string> = {
  trend: 'Trend',
  feed_item: 'Feed item',
  repurpose: 'Repurpose',
};

export const FORMAT_LABEL: Record<Format, string> = {
  reel: 'Reel',
  story: 'Story',
  feed_post: 'Feed post',
};

export const ROLE_LABEL: Record<Role, string> = {
  attract: 'Attract',
  educate: 'Educate',
  build_trust: 'Build trust',
  convert: 'Convert',
  engage: 'Engage',
};

export const roleText = (role: Role | null | undefined, empty = 'Not set') =>
  role ? (ROLE_LABEL[role] ?? role) : empty;

// --- Plans -------------------------------------------------------------------------------------

const PLAN_STATUS_LABEL: Record<PlanSummary['status'], string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
};

/** "28 Nov" from "2026-11-28". */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()} ${month}`;
}

/** "Week of 28 Nov — Active". */
export const planOptionLabel = (
  plan: Pick<PlanSummary, 'week_start' | 'status'>,
) =>
  `Week of ${shortDate(plan.week_start)} — ${PLAN_STATUS_LABEL[plan.status]}`;

/**
 * The default plan (E03-S03 Panel): the current plan from `GET /plans/current/` when it is in
 * the list, otherwise the nearest upcoming draft or active plan, otherwise the latest one.
 */
export function defaultPlanId(
  plans: Pick<PlanSummary, 'id' | 'week_start' | 'week_end' | 'status'>[],
  currentPlanId: number | null,
  today: string,
): number | null {
  const open = plans.filter((plan) => plan.status !== 'closed');
  if (
    currentPlanId !== null &&
    open.some((plan) => plan.id === currentPlanId)
  ) {
    return currentPlanId;
  }
  const upcoming = open
    .filter((plan) => plan.week_end >= today)
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
  if (upcoming.length) return upcoming[0].id;
  const latest = [...open].sort((a, b) =>
    b.week_start.localeCompare(a.week_start),
  );
  return latest[0]?.id ?? null;
}

// --- Feed items --------------------------------------------------------------------------------

export type FeedItemAction = {
  key: string;
  label: string;
  to: FeedItemStatus;
};

const MARK_ELIGIBLE: FeedItemAction = {
  key: 'eligible',
  label: 'Mark eligible',
  to: 'eligible',
};
const IGNORE: FeedItemAction = {
  key: 'ignore',
  label: 'Ignore',
  to: 'ignored',
};

/** Row actions by status (E03-S01 Panel, rule 18). */
export function feedItemActions(
  item: Pick<FeedItem, 'status' | 'content_item'>,
): FeedItemAction[] {
  switch (item.status) {
    case 'new':
      return [MARK_ELIGIBLE, IGNORE];
    case 'eligible':
      return [IGNORE];
    case 'ignored':
      return [MARK_ELIGIBLE];
    case 'used':
      return !item.content_item || item.content_item.status === 'cancelled'
        ? [MARK_ELIGIBLE]
        : [];
    default:
      return [];
  }
}

/** "5 updated, 1 could not be changed". */
export function bulkResultText(updated: number, failed: number): string {
  const parts = [`${updated} updated`];
  if (failed) parts.push(`${failed} could not be changed`);
  return parts.join(', ');
}

// --- Feed sources ------------------------------------------------------------------------------

/** Error text for a source's `last_status` code (E03-S01 Panel). */
export function feedErrorText(
  status: string | null | undefined,
): string | null {
  if (!status?.startsWith('error:')) return null;
  const code = status.slice('error:'.length);
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return `The feed answered with HTTP ${http[1]}.`;
  switch (code) {
    case 'timeout':
      return 'The feed did not answer within 15 seconds.';
    case 'fetch_failed':
      return 'The feed could not be reached.';
    case 'parse_failed':
      return 'The feed is not valid RSS, Atom or JSON.';
    case 'mapping_failed':
      return 'The items path or a field path does not match the response.';
    case 'too_large':
      return 'The feed is larger than 5 MB.';
    case 'blocked_url':
      return 'This address is not allowed.';
    case 'auth_header_missing':
      return 'The auth header variable is not set on the server.';
    default:
      return 'The feed could not be read.';
  }
}

/** "4 new, 1 updated" for a finished sync job. */
export function syncResultText(
  result:
    | {
        created?: number;
        updated?: number;
      }
    | null
    | undefined,
): string {
  if (!result) return 'Sync finished';
  return `${result.created ?? 0} new, ${result.updated ?? 0} updated`;
}

// --- Candidates --------------------------------------------------------------------------------

/** "Evidence 72 · Goal fit 85 · Freshness 76", with "—" for a score not computed yet. */
export function subScoresText(c: {
  evidence_score: number | null;
  goal_fit_score: number | null;
  freshness_score: number | null;
}): string {
  const v = (n: number | null) =>
    n === null || n === undefined ? '—' : String(n);
  return `Evidence ${v(c.evidence_score)} · Goal fit ${v(c.goal_fit_score)} · Freshness ${v(c.freshness_score)}`;
}

/** "77.8" from "77.80"; "—" when not scored. */
export function scoreText(total: string | null | undefined): string {
  if (total === null || total === undefined || total === '') return '—';
  const n = Number(total);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : total;
}

/** "6 open slots · 14 candidates · last ranked 22 Nov, 12:44" (the time is pre-formatted). */
export function summaryLine(
  openSlots: number,
  candidates: number,
  rankedLabel: string | null,
): string {
  const slots = `${openSlots} open slot${openSlots === 1 ? '' : 's'}`;
  if (!rankedLabel) return `${slots} · Not ranked yet`;
  const count = `${candidates} candidate${candidates === 1 ? '' : 's'}`;
  return `${slots} · ${count} · last ranked ${rankedLabel}`;
}

/** "14 candidates ranked, 6 proposed" for a finished ranking job. */
export function rankResultText(
  result:
    | {
        candidates?: number;
        proposed?: number;
        auto_confirmed?: number;
      }
    | null
    | undefined,
): string {
  if (!result) return 'Ranking finished';
  const base = `${result.candidates ?? 0} candidates ranked, ${result.proposed ?? 0} proposed`;
  return result.auto_confirmed
    ? `${base}, ${result.auto_confirmed} confirmed by autopilot`
    : base;
}

// --- Proposal ----------------------------------------------------------------------------------

export type ProposalRow = {
  slot: ProposalSlot;
  /** The candidate the operator chose, or null for "No candidate". */
  candidateId: number | null;
};

/** The open slots in time order, each with the server's proposed candidate (rule 8). */
export function initialRows(proposal: Proposal): ProposalRow[] {
  const rows: ProposalRow[] = [
    ...proposal.assignments.map((a) => ({
      slot: a.slot,
      candidateId: a.candidate.id,
    })),
    ...proposal.unfilled_slots.map((slot) => ({ slot, candidateId: null })),
  ];
  return rows.sort((a, b) =>
    a.slot.scheduled_at.localeCompare(b.slot.scheduled_at),
  );
}

/** Every candidate a row may choose: proposed ones first, then unassigned, by rank. */
export function proposalCandidates(proposal: Proposal): ProposalCandidate[] {
  const all = [
    ...proposal.assignments.map((a) => a.candidate),
    ...proposal.unassigned_candidates,
  ];
  const unique = new Map<number, ProposalCandidate>();
  for (const candidate of all) {
    if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
  }
  return [...unique.values()].sort(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER),
  );
}

/** "#1 Five-minute desk setup — 77.8". */
export const candidateOptionLabel = (c: ProposalCandidate) =>
  `${c.rank === null ? '—' : `#${c.rank}`} ${c.title} — ${scoreText(c.total_score)}`;

export type PanelFit = { formatMatch: boolean; roleMatch: boolean | null };

/**
 * Fit of a chosen pair, computed in the panel (E03-S03 Panel). `roleMatch` is null when the slot
 * has no role, which is shown as neither a match nor a difference.
 */
export function computeFit(
  slot: Pick<ProposalSlot, 'format' | 'role'>,
  candidate: Pick<ProposalCandidate, 'suggested_formats' | 'suggested_role'>,
): PanelFit {
  const formatMatch =
    candidate.suggested_formats.length === 0 ||
    candidate.suggested_formats.includes(slot.format);
  const roleMatch =
    slot.role === null ? null : slot.role === candidate.suggested_role;
  return { formatMatch, roleMatch };
}

export function filledCount(rows: ProposalRow[]): number {
  return rows.filter((row) => row.candidateId !== null).length;
}

export function toAssignments(rows: ProposalRow[]) {
  return rows
    .filter((row) => row.candidateId !== null)
    .map((row) => ({
      candidate: row.candidateId as number,
      slot: row.slot.id,
    }));
}

const CONFIRM_FIELD_TEXT: Record<string, string> = {
  slot_not_open: 'This slot is no longer open',
  slot_in_past: 'This slot is in the past',
  not_selectable: 'This candidate was already selected',
  does_not_exist: 'This choice is no longer in the plan',
  duplicate: 'This is chosen twice',
};

/**
 * Maps confirm's field errors (`assignments.{i}.candidate|slot`) back to the slot of each row
 * that was sent, so the table can show them under the candidate select.
 */
export function confirmErrorsBySlot(
  fields: { path: string; code: string }[],
  sent: { candidate: number; slot: number }[],
): Record<number, string> {
  const bySlot: Record<number, string> = {};
  for (const field of fields) {
    const match = /^assignments\.(\d+)\.(candidate|slot)$/.exec(field.path);
    if (!match) continue;
    const assignment = sent[Number(match[1])];
    if (!assignment) continue;
    bySlot[assignment.slot] ??=
      CONFIRM_FIELD_TEXT[field.code] ?? 'This choice is not valid';
  }
  return bySlot;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}
