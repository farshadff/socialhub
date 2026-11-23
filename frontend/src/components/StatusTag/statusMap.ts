/**
 * The one status colour and label map for the panel (docs/DESIGN-SYSTEM.md section 3).
 * Colours are Ant Design tag presets, never literal colours. New kinds and values are added to
 * DESIGN-SYSTEM.md first, then here; epics never define their own status colours.
 *
 * Preset per meaning: not started / neutral `default` (grey) · in progress `processing` (blue) ·
 * waiting for a person `warning` (orange) · ready / scheduled `cyan` · done / good `success`
 * (green) · problem `error` (red).
 */
export type StatusColor =
  | 'default'
  | 'processing'
  | 'warning'
  | 'cyan'
  | 'success'
  | 'error';

export type StatusEntry = { color: StatusColor; label: string };

const e = (color: StatusColor, label: string): StatusEntry => ({
  color,
  label,
});

/** `error:<code>` values fall back to a kind's `error:*` entry. */
const sourceHealth = {
  ok: e('success', 'OK'),
  empty: e('default', 'Nothing new'),
  'error:*': e('error', 'Failed'),
};

export const STATUS_MAP: Record<string, Record<string, StatusEntry>> = {
  item: {
    selected: e('default', 'Selected'),
    briefed: e('processing', 'Briefed'),
    scripted: e('processing', 'Scripted'),
    in_production: e('processing', 'In production'),
    in_check: e('processing', 'In check'),
    needs_revision: e('warning', 'Needs revision'),
    in_review: e('warning', 'In review'),
    approved: e('cyan', 'Approved'),
    scheduled: e('cyan', 'Scheduled'),
    publishing: e('processing', 'Publishing'),
    published: e('success', 'Published'),
    failed: e('error', 'Failed'),
    cancelled: e('default', 'Cancelled'),
  },
  plan: {
    draft: e('default', 'Draft'),
    active: e('success', 'Active'),
    closed: e('default', 'Closed'),
  },
  slot: {
    open: e('default', 'Open'),
    skipped: e('default', 'Skipped'),
    reserved: e('cyan', 'Reserved'),
    scheduled: e('cyan', 'Scheduled'),
    published: e('success', 'Published'),
  },
  candidate: {
    candidate: e('default', 'Candidate'),
    rejected: e('default', 'Rejected'),
    proposed: e('cyan', 'Proposed'),
    selected: e('success', 'Selected'),
  },
  topic: {
    new: e('default', 'New'),
    dismissed: e('default', 'Dismissed'),
    shortlisted: e('cyan', 'Shortlisted'),
    used: e('success', 'Used'),
  },
  job: {
    queued: e('processing', 'Queued'),
    running: e('processing', 'Running'),
    succeeded: e('success', 'Succeeded'),
    failed: e('error', 'Failed'),
    cancelled: e('default', 'Cancelled'),
  },
  qc: {
    pass: e('success', 'Pass'),
    revise: e('warning', 'Revise'),
    escalate: e('error', 'Escalate'),
  },
  review: {
    open: e('warning', 'Open'),
    resolved: e('default', 'Resolved'),
  },
  publication: {
    scheduled: e('cyan', 'Scheduled'),
    publishing: e('processing', 'Publishing'),
    verifying: e('processing', 'Verifying'),
    published: e('success', 'Published'),
    failed: e('error', 'Failed'),
    cancelled: e('default', 'Cancelled'),
    // Flags shown next to the status. Pass `label` for "Retry n of 3".
    retry: e('warning', 'Retry'),
    post_by_hand_due: e('warning', 'Post by hand — due'),
    post_by_hand: e('default', 'Post by hand'),
    publishing_paused: e('error', 'Publishing off'),
    connection_problem: e('error', 'Connection problem'),
    daily_limit: e('error', 'Daily limit'),
  },
  attempt: {
    running: e('processing', 'Running'),
    success: e('success', 'Success'),
    verified_live: e('success', 'Verified live'),
    retryable_error: e('warning', 'Retryable error'),
    ambiguous: e('warning', 'Ambiguous'),
    fatal_error: e('error', 'Fatal error'),
  },
  connection: {
    connected: e('success', 'Connected'),
    expiring: e('warning', 'Expiring soon'),
    needs_attention: e('warning', 'Needs attention'),
    disconnected: e('default', 'Disconnected'),
  },
  verdict: {
    outperforming: e('success', 'Outperforming'),
    on_par: e('default', 'On par'),
    underperforming: e('error', 'Underperforming'),
    insufficient_data: e('default', 'Not enough data'),
  },
  goal: {
    met: e('success', 'Goal met'),
    /** `missed` at a non-final checkpoint. */
    missed_pending: e('warning', 'Goal not met yet'),
    /** `missed` at the final checkpoint. */
    missed: e('error', 'Goal missed'),
    no_goal: e('default', 'No goal'),
    not_measured: e('default', 'Not measured'),
  },
  account: {
    active: e('success', 'Active'),
    archived: e('default', 'Archived'),
  },
  publishing: {
    on: e('success', 'Publishing on'),
    off: e('error', 'Publishing off'),
  },
  research_run: {
    running: e('processing', 'Running'),
    completed: e('success', 'Completed'),
    failed: e('error', 'Failed'),
  },
  research_source: sourceHealth,
  feed_item: {
    new: e('default', 'New'),
    ignored: e('default', 'Ignored'),
    eligible: e('cyan', 'Eligible'),
    used: e('success', 'Used'),
  },
  feed_source: sourceHealth,
  brief: {
    draft: e('warning', 'Waiting for approval'),
    approved: e('success', 'Approved'),
    superseded: e('default', 'Superseded'),
  },
  script: {
    draft: e('warning', 'Waiting for approval'),
    approved: e('success', 'Approved'),
    superseded: e('default', 'Superseded'),
  },
  rights: {
    cleared: e('success', 'Cleared'),
    unknown: e('warning', 'Unknown'),
    restricted: e('error', 'Restricted'),
    expired: e('error', 'Expired'),
  },
  clip: {
    ok: e('success', 'Ready'),
    padded: e('warning', 'Padded'),
    needs_clip: e('warning', 'Needs clip'),
    too_short: e('error', 'Too short'),
  },
  report: {
    draft: e('default', 'Draft'),
    accepted: e('success', 'Accepted'),
  },
  finding: {
    worked: e('success', 'Worked'),
    did_not_work: e('error', 'Did not work'),
    insight: e('processing', 'Insight'),
  },
  carried_finding: {
    pending: e('warning', 'Pending'),
    applied: e('success', 'Applied'),
    ignored: e('default', 'Ignored'),
  },
  repurpose: {
    open: e('cyan', 'Open'),
    in_selection: e('processing', 'In selection'),
    used: e('success', 'Used'),
    dismissed: e('default', 'Dismissed'),
  },
  ai_run: {
    ok: e('success', 'OK'),
    refused: e('warning', 'Refused'),
    error: e('error', 'Error'),
  },
  system: {
    ok: e('success', 'OK'),
    unknown: e('default', 'Unknown'),
    unavailable: e('error', 'Unavailable'),
  },
  metrics: {
    incomplete: e('default', 'Incomplete'),
    collecting: e('processing', 'Collecting'),
    overdue: e('warning', 'Overdue'),
    needs_manual_entry: e('warning', 'Needs manual entry'),
    complete: e('success', 'Complete'),
  },
  checkpoint: {
    skipped: e('default', 'Skipped'),
    upcoming: e('default', 'Upcoming'),
    due: e('processing', 'Due'),
    overdue: e('warning', 'Overdue'),
    captured: e('success', 'Captured'),
  },
  // Render state of a production frame (E06-S07).
  frame: {
    rendered: e('success', 'Rendered'),
    stale: e('warning', 'Needs render'),
    failed: e('error', 'Failed'),
    pending: e('default', 'Not rendered'),
  },

  // Tags that are not statuses (DESIGN-SYSTEM.md section 3, second table).
  severity: {
    blocker: e('error', 'Blocker'),
    major: e('warning', 'Major'),
    minor: e('processing', 'Minor'),
    info: e('default', 'Info'),
  },
  attention: {
    high: e('error', 'High'),
    medium: e('warning', 'Medium'),
    low: e('default', 'Low'),
  },
  review_reason: {
    qc_escalated: e('default', 'Check escalated'),
    max_revisions: e('default', 'Revision limit reached'),
    publish_failed: e('default', 'Publishing failed'),
    no_slot: e('default', 'No slot available'),
    manual: e('default', 'Raised by hand'),
  },
  review_decision: {
    approve: e('default', 'Approve'),
    request_changes: e('default', 'Request changes'),
    reject: e('default', 'Reject'),
  },
  provisional: {
    provisional: e('default', 'Provisional'),
  },
};

/** The kinds `StatusTag` knows, for type hints and tests. */
export type StatusKind = keyof typeof STATUS_MAP;

/** `needs_revision` → "Needs revision"; `error:timeout` → "Error timeout". */
export function sentenceCase(value: string): string {
  const text = value.replace(/[_:]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';
}

/** Looks up a kind and status. `error:<code>` values fall back to the kind's `error:*` entry. */
export function lookupStatus(kind: string, status: string): StatusEntry | null {
  const entries = STATUS_MAP[kind];
  if (!entries) return null;
  if (Object.hasOwn(entries, status)) return entries[status];
  const prefix = status.split(':')[0];
  if (prefix !== status && entries[`${prefix}:*`])
    return entries[`${prefix}:*`];
  return null;
}
