import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import StatusTag, { lookupStatus, STATUS_MAP, sentenceCase } from './index';

/**
 * Expected colours, transcribed from docs/DESIGN-SYSTEM.md section 3 (one row per meaning).
 * Every entry in STATUS_MAP must appear here, and every pair here must map to its colour.
 */
const EXPECTED: Record<string, Record<string, string[]>> = {
  default: {
    item: ['selected', 'cancelled'],
    plan: ['draft', 'closed'],
    slot: ['open', 'skipped'],
    candidate: ['candidate', 'rejected'],
    topic: ['new', 'dismissed'],
    feed_item: ['new', 'ignored'],
    feed_source: ['empty'],
    research_source: ['empty'],
    account: ['archived'],
    connection: ['disconnected'],
    brief: ['superseded'],
    script: ['superseded'],
    publication: ['cancelled', 'post_by_hand'],
    review: ['resolved'],
    verdict: ['on_par', 'insufficient_data'],
    goal: ['no_goal', 'not_measured'],
    report: ['draft'],
    carried_finding: ['ignored'],
    repurpose: ['dismissed'],
    metrics: ['incomplete'],
    checkpoint: ['skipped', 'upcoming'],
    system: ['unknown'],
    job: ['cancelled'],
    frame: ['pending'],
    severity: ['info'],
    attention: ['low'],
    review_reason: [
      'qc_escalated',
      'max_revisions',
      'publish_failed',
      'no_slot',
      'manual',
    ],
    review_decision: ['approve', 'request_changes', 'reject'],
    provisional: ['provisional'],
  },
  processing: {
    item: ['briefed', 'scripted', 'in_production', 'in_check', 'publishing'],
    job: ['queued', 'running'],
    research_run: ['running'],
    publication: ['publishing', 'verifying'],
    attempt: ['running'],
    repurpose: ['in_selection'],
    metrics: ['collecting'],
    checkpoint: ['due'],
    severity: ['minor'],
    finding: ['insight'],
  },
  warning: {
    item: ['needs_revision', 'in_review'],
    review: ['open'],
    brief: ['draft'],
    script: ['draft'],
    connection: ['expiring', 'needs_attention'],
    qc: ['revise'],
    attempt: ['retryable_error', 'ambiguous'],
    publication: ['retry', 'post_by_hand_due'],
    rights: ['unknown'],
    clip: ['needs_clip', 'padded'],
    goal: ['missed_pending'],
    carried_finding: ['pending'],
    ai_run: ['refused'],
    metrics: ['overdue', 'needs_manual_entry'],
    checkpoint: ['overdue'],
    frame: ['stale'],
    severity: ['major'],
    attention: ['medium'],
  },
  cyan: {
    item: ['approved', 'scheduled'],
    slot: ['reserved', 'scheduled'],
    publication: ['scheduled'],
    candidate: ['proposed'],
    topic: ['shortlisted'],
    feed_item: ['eligible'],
    repurpose: ['open'],
  },
  success: {
    item: ['published'],
    plan: ['active'],
    slot: ['published'],
    candidate: ['selected'],
    topic: ['used'],
    feed_item: ['used'],
    feed_source: ['ok'],
    research_source: ['ok'],
    research_run: ['completed'],
    account: ['active'],
    publishing: ['on'],
    connection: ['connected'],
    brief: ['approved'],
    script: ['approved'],
    qc: ['pass'],
    publication: ['published'],
    attempt: ['success', 'verified_live'],
    rights: ['cleared'],
    clip: ['ok'],
    verdict: ['outperforming'],
    goal: ['met'],
    report: ['accepted'],
    carried_finding: ['applied'],
    repurpose: ['used'],
    ai_run: ['ok'],
    system: ['ok'],
    metrics: ['complete'],
    checkpoint: ['captured'],
    job: ['succeeded'],
    frame: ['rendered'],
    finding: ['worked'],
  },
  error: {
    item: ['failed'],
    job: ['failed'],
    research_run: ['failed'],
    feed_source: ['error:*'],
    research_source: ['error:*'],
    publishing: ['off'],
    qc: ['escalate'],
    publication: [
      'failed',
      'publishing_paused',
      'connection_problem',
      'daily_limit',
    ],
    attempt: ['fatal_error'],
    rights: ['restricted', 'expired'],
    clip: ['too_short'],
    verdict: ['underperforming'],
    goal: ['missed'],
    ai_run: ['error'],
    system: ['unavailable'],
    frame: ['failed'],
    severity: ['blocker'],
    attention: ['high'],
    finding: ['did_not_work'],
  },
};

const expectedRows = Object.entries(EXPECTED).flatMap(([color, kinds]) =>
  Object.entries(kinds).flatMap(([kind, statuses]) =>
    statuses.map((status) => [kind, status, color] as const),
  ),
);

describe('StatusTag mapping (DESIGN-SYSTEM.md section 3)', () => {
  it.each(expectedRows)('%s %s → %s', (kind, status, color) => {
    expect(STATUS_MAP[kind]?.[status]?.color).toBe(color);
  });

  it('has no entry that the design table does not list', () => {
    const listed = new Set(expectedRows.map(([k, s]) => `${k}/${s}`));
    const mapped = Object.entries(STATUS_MAP).flatMap(([kind, entries]) =>
      Object.keys(entries).map((status) => `${kind}/${status}`),
    );
    expect(mapped.filter((key) => !listed.has(key))).toEqual([]);
  });

  it.each([
    ['item', 'needs_revision', 'Needs revision'],
    ['item', 'in_production', 'In production'],
    ['connection', 'connected', 'Connected'],
    ['connection', 'expiring', 'Expiring soon'],
    ['connection', 'needs_attention', 'Needs attention'],
    ['connection', 'disconnected', 'Disconnected'],
    ['publishing', 'on', 'Publishing on'],
    ['publishing', 'off', 'Publishing off'],
    ['publication', 'verifying', 'Verifying'],
    ['brief', 'draft', 'Waiting for approval'],
    ['verdict', 'insufficient_data', 'Not enough data'],
    ['clip', 'ok', 'Ready'],
    ['goal', 'missed_pending', 'Goal not met yet'],
  ])('%s %s reads "%s"', (kind, status, label) => {
    expect(lookupStatus(kind, status)?.label).toBe(label);
  });

  it('matches error:<code> by prefix for source health', () => {
    expect(lookupStatus('feed_source', 'error:http_404')).toEqual({
      color: 'error',
      label: 'Failed',
    });
    expect(lookupStatus('research_source', 'error:timeout')?.color).toBe(
      'error',
    );
  });

  it('returns null for an unknown pair, including inherited keys', () => {
    expect(lookupStatus('topic', 'archived')).toBeNull();
    expect(lookupStatus('nope', 'new')).toBeNull();
    expect(lookupStatus('topic', 'constructor')).toBeNull();
  });

  it('renders acceptance 9: item needs_revision is an orange "Needs revision" tag', async () => {
    const screen = await render(
      <StatusTag kind="item" status="needs_revision" />,
    );
    const tag = screen.getByText('Needs revision').element();
    expect(tag.className).toMatch(/ant-tag-warning|ant-tag-orange/);
  });

  it('renders an unknown status as a grey tag in sentence case', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const screen = await render(
      <StatusTag kind="topic" status="waiting_for_input" />,
    );
    await expect
      .element(screen.getByText('Waiting for input'))
      .toBeInTheDocument();
    warn.mockRestore();
  });

  it('uses a caller label when given', async () => {
    const screen = await render(
      <StatusTag kind="publication" status="retry" label="Retry 2 of 3" />,
    );
    await expect.element(screen.getByText('Retry 2 of 3')).toBeInTheDocument();
  });

  it('sentence-cases raw values', () => {
    expect(sentenceCase('needs_revision')).toBe('Needs revision');
  });
});
