import { describe, expect, it } from 'vitest';
import type { Proposal } from '@/services/socialhub/selection';
import {
  bulkResultText,
  candidateOptionLabel,
  computeFit,
  confirmErrorsBySlot,
  defaultPlanId,
  feedErrorText,
  feedItemActions,
  filledCount,
  initialRows,
  planOptionLabel,
  proposalCandidates,
  rankResultText,
  scoreText,
  subScoresText,
  summaryLine,
  syncResultText,
  toAssignments,
} from './logic';

const plan = (
  id: number,
  week_start: string,
  week_end: string,
  status: 'draft' | 'active' | 'closed',
) => ({
  id,
  week_start,
  week_end,
  status,
});

describe('defaultPlanId', () => {
  const plans = [
    plan(11, '2026-11-14', '2026-11-20', 'closed'),
    plan(12, '2026-11-21', '2026-11-27', 'active'),
    plan(13, '2026-11-28', '2026-12-04', 'draft'),
  ];

  it('uses the current plan when it is open', () => {
    expect(defaultPlanId(plans, 13, '2026-11-23')).toBe(13);
  });

  it('falls back to the nearest plan whose week is not over', () => {
    expect(defaultPlanId(plans, null, '2026-11-23')).toBe(12);
    expect(defaultPlanId(plans, null, '2026-11-28')).toBe(13);
  });

  it('ignores a closed current plan', () => {
    expect(defaultPlanId(plans, 11, '2026-11-23')).toBe(12);
  });

  it('returns the latest open plan when every week is over, and null without plans', () => {
    expect(defaultPlanId(plans, null, '2027-01-01')).toBe(13);
    expect(defaultPlanId([], null, '2026-11-23')).toBeNull();
  });
});

describe('labels', () => {
  it('formats the plan option', () => {
    expect(
      planOptionLabel({ week_start: '2026-11-28', status: 'active' }),
    ).toBe('Week of 28 Nov — Active');
  });

  it('formats scores', () => {
    expect(scoreText('77.80')).toBe('77.8');
    expect(scoreText(null)).toBe('—');
    expect(
      subScoresText({
        evidence_score: 72,
        goal_fit_score: null,
        freshness_score: 76,
      }),
    ).toBe('Evidence 72 · Goal fit — · Freshness 76');
  });

  it('builds the summary line', () => {
    expect(summaryLine(6, 14, '22 Nov 2026, 12:44')).toBe(
      '6 open slots · 14 candidates · last ranked 22 Nov 2026, 12:44',
    );
    expect(summaryLine(1, 0, null)).toBe('1 open slot · Not ranked yet');
  });

  it('describes job results', () => {
    expect(
      rankResultText({ candidates: 14, proposed: 6, auto_confirmed: 0 }),
    ).toBe('14 candidates ranked, 6 proposed');
    expect(
      rankResultText({ candidates: 3, proposed: 2, auto_confirmed: 2 }),
    ).toBe('3 candidates ranked, 2 proposed, 2 confirmed by autopilot');
    expect(syncResultText({ created: 4, updated: 1 })).toBe('4 new, 1 updated');
    expect(bulkResultText(5, 1)).toBe('5 updated, 1 could not be changed');
    expect(bulkResultText(3, 0)).toBe('3 updated');
  });
});

describe('feedItemActions (rule 18)', () => {
  const keys = (status: any, content_item: any = null) =>
    feedItemActions({ status, content_item }).map((a) => a.to);

  it('offers the allowed moves per status', () => {
    expect(keys('new')).toEqual(['eligible', 'ignored']);
    expect(keys('eligible')).toEqual(['ignored']);
    expect(keys('ignored')).toEqual(['eligible']);
  });

  it('lets a used item return only when its content item is gone or cancelled', () => {
    expect(keys('used')).toEqual(['eligible']);
    expect(keys('used', { id: 4, status: 'cancelled' })).toEqual(['eligible']);
    expect(keys('used', { id: 4, status: 'briefed' })).toEqual([]);
  });
});

describe('feedErrorText', () => {
  it('maps every last_status code', () => {
    expect(feedErrorText('ok')).toBeNull();
    expect(feedErrorText(null)).toBeNull();
    expect(feedErrorText('error:http_401')).toBe(
      'The feed answered with HTTP 401.',
    );
    expect(feedErrorText('error:timeout')).toBe(
      'The feed did not answer within 15 seconds.',
    );
    expect(feedErrorText('error:mapping_failed')).toBe(
      'The items path or a field path does not match the response.',
    );
    expect(feedErrorText('error:auth_header_missing')).toBe(
      'The auth header variable is not set on the server.',
    );
    expect(feedErrorText('error:something_new')).toBe(
      'The feed could not be read.',
    );
  });
});

const slot = (id: number, at: string, format: any, role: any = null) => ({
  id,
  scheduled_at: at,
  format,
  role,
  status: 'open' as const,
});
const cand = (
  id: number,
  rank: number | null,
  formats: any[],
  role: any,
  duplicate = false,
) => ({
  id,
  kind: 'trend' as const,
  title: `Candidate ${id}`,
  rank,
  total_score: '50.00',
  suggested_formats: formats,
  suggested_role: role,
  duplicate_of: duplicate
    ? { id: 38, title: 'Old', status: 'published' as const }
    : null,
});

const proposal: Proposal = {
  plan: {
    id: 12,
    status: 'active',
    week_start: '2026-11-28',
    week_end: '2026-12-04',
  },
  ranked_at: '2026-11-22T09:14:31Z',
  autopilot: false,
  assignments: [
    {
      slot: slot(103, '2026-11-30T15:30:00Z', 'feed_post', 'build_trust'),
      candidate: cand(543, 3, ['feed_post'], 'attract'),
      fit: {
        format_points: 3,
        role_points: 0,
        format_match: true,
        role_match: false,
      },
    },
    {
      slot: slot(101, '2026-11-28T15:30:00Z', 'reel', 'educate'),
      candidate: cand(540, 1, ['reel', 'story'], 'educate'),
      fit: {
        format_points: 3,
        role_points: 2,
        format_match: true,
        role_match: true,
      },
    },
  ],
  unfilled_slots: [slot(102, '2026-11-29T08:30:00Z', 'story')],
  unassigned_candidates: [
    cand(541, 2, ['reel'], 'educate'),
    cand(546, 12, ['feed_post'], 'build_trust', true),
  ],
  reserved_slots: [],
  warnings: [],
};

describe('proposal editing', () => {
  it('lists the open slots in time order with the proposed candidates', () => {
    const rows = initialRows(proposal);
    expect(rows.map((r) => [r.slot.id, r.candidateId])).toEqual([
      [101, 540],
      [102, null],
      [103, 543],
    ]);
    expect(filledCount(rows)).toBe(2);
    expect(toAssignments(rows)).toEqual([
      { candidate: 540, slot: 101 },
      { candidate: 543, slot: 103 },
    ]);
  });

  it('offers every candidate once, by rank', () => {
    expect(proposalCandidates(proposal).map((c) => c.id)).toEqual([
      540, 541, 543, 546,
    ]);
    expect(candidateOptionLabel(proposal.assignments[1].candidate)).toBe(
      '#1 Candidate 540 — 50',
    );
  });

  it('computes fit for a chosen pair', () => {
    expect(
      computeFit(
        slot(1, '', 'reel', 'educate'),
        cand(1, 1, ['reel'], 'educate'),
      ),
    ).toEqual({
      formatMatch: true,
      roleMatch: true,
    });
    expect(
      computeFit(
        slot(1, '', 'story', 'educate'),
        cand(1, 1, ['reel'], 'attract'),
      ),
    ).toEqual({
      formatMatch: false,
      roleMatch: false,
    });
    // No slot role is neither a match nor a difference; no suggested formats fits anything.
    expect(
      computeFit(slot(1, '', 'story', null), cand(1, 1, [], 'attract')),
    ).toEqual({
      formatMatch: true,
      roleMatch: null,
    });
  });

  it('maps confirm field errors to the rows that were sent', () => {
    const sent = [
      { candidate: 540, slot: 101 },
      { candidate: 543, slot: 103 },
    ];
    expect(
      confirmErrorsBySlot(
        [
          { path: 'assignments.1.slot', code: 'slot_not_open' },
          { path: 'assignments.0.candidate', code: 'not_selectable' },
          { path: 'plan', code: 'invalid' },
        ],
        sent,
      ),
    ).toEqual({
      103: 'This slot is no longer open',
      101: 'This candidate was already selected',
    });
  });
});
