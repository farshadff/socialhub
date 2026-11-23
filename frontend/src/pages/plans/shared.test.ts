import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import type { CarriedFinding, Plan } from '@/services/socialhub/plans';
import {
  allowedGoalFormats,
  allowedScopes,
  buildPatch,
  findingEffect,
  findingStatesFrom,
  formValuesFrom,
  metricsWithoutGoal,
  planFieldText,
  SLOT_PERMISSIONS,
  slotSummaryLine,
  weekEnded,
  weekRange,
  weekStartOptions,
} from './shared';

// Monday 23 Nov 2026 08:00 UTC = 11:30 in Tehran.
const NOW = dayjs('2026-11-23T08:00:00Z');
const tehran = { timezone: 'Asia/Tehran', week_start_day: 5 };

const finding = (over: Partial<CarriedFinding>): CarriedFinding => ({
  id: 'f1',
  report_id: 7,
  type: 'worked',
  title: 'Evening reels reached more people',
  detail: '',
  recommendation: 'Post reels at 19:00.',
  plan_field: 'none',
  suggested_change: null,
  state: 'pending',
  ...over,
});

const plan = {
  objective: 'Launch',
  audience_summary: 'Homeowners',
  audience_segments: [],
  success_metrics: ['reach', 'saves'],
  goals: [{ id: 1, metric: 'reach', scope: 'week_total', format: null, target_value: 100 }],
  notes: '',
  carried_findings: [finding({})],
} as unknown as Plan;

describe('weeks', () => {
  it('offers the current week and the next eight, starting on the account day', () => {
    const weeks = weekStartOptions(tehran, NOW);
    expect(weeks).toHaveLength(9);
    expect(weeks[0]).toBe('2026-11-21');
    expect(weeks[1]).toBe('2026-11-28');
    expect(weeks[8]).toBe('2027-01-16');
  });

  it('uses the account timezone for "today"', () => {
    // Fri 20 Nov 21:00 UTC is already Saturday in Tehran: a new week has begun.
    expect(weekStartOptions(tehran, dayjs('2026-11-20T21:00:00Z'))[0]).toBe('2026-11-21');
    expect(
      weekStartOptions({ timezone: 'UTC', week_start_day: 5 }, dayjs('2026-11-20T21:00:00Z'))[0],
    ).toBe('2026-11-14');
    expect(weekEnded('2026-11-20', 'Asia/Tehran', dayjs('2026-11-20T21:00:00Z'))).toBe(true);
    expect(weekEnded('2026-11-20', 'UTC', dayjs('2026-11-20T21:00:00Z'))).toBe(false);
  });

  it('formats a week range', () => {
    expect(weekRange('2026-11-28', '2026-12-04')).toBe('28 Nov – 4 Dec 2026');
  });
});

describe('goal rules', () => {
  it('limits scope and format by metric', () => {
    expect(allowedScopes('follower_growth')).toEqual(['week_total']);
    expect(allowedGoalFormats('follower_growth')).toEqual(['all']);
    expect(allowedGoalFormats('replies')).toEqual(['all', 'story']);
    expect(allowedGoalFormats('reach')).toHaveLength(4);
  });

  it('lists success metrics without a goal', () => {
    expect(metricsWithoutGoal(['reach', 'saves'], [{ metric: 'reach' }])).toEqual(['saves']);
  });
});

describe('carried findings', () => {
  it('appends the recommendation for text fields', () => {
    expect(findingEffect(finding({ plan_field: 'audience' }))).toEqual({
      kind: 'append',
      field: 'audience_summary',
      text: 'Post reels at 19:00.',
    });
  });

  it('pre-fills a goal only from a complete suggestion', () => {
    const complete = finding({
      plan_field: 'goals',
      suggested_change: { metric: 'saves', scope: 'per_post', format: null, target_value: 120 },
    });
    expect(findingEffect(complete)).toEqual({
      kind: 'goal',
      goal: { metric: 'saves', scope: 'per_post', format: 'all', target_value: 120 },
    });
    expect(findingEffect(finding({ plan_field: 'goals', suggested_change: { note: 'x' } }))).toEqual(
      { kind: 'goal', goal: {} },
    );
    expect(findingEffect(finding({ plan_field: 'slots' }))).toEqual({ kind: 'none' });
  });
});

describe('buildPatch', () => {
  const initial = formValuesFrom(plan);
  const states = findingStatesFrom(plan);

  it('is empty when nothing changed', () => {
    expect(buildPatch(initial, structuredClone(initial), states, { ...states })).toEqual({});
  });

  it('sends only changed fields, with goals in the API shape', () => {
    const values = structuredClone(initial);
    values.objective = 'Launch week';
    values.goals = [...values.goals, { metric: 'saves', scope: 'week_total', format: 'all', target_value: 50 }];
    expect(buildPatch(initial, values, states, { ...states, f1: 'applied' })).toEqual({
      objective: 'Launch week',
      goals: [
        { id: 1, metric: 'reach', scope: 'week_total', format: null, target_value: 100 },
        { metric: 'saves', scope: 'week_total', format: null, target_value: 50 },
      ],
      carried_findings_state: [{ id: 'f1', state: 'applied' }],
    });
  });
});

describe('slots', () => {
  it('follows the status matrix of E01-S02 rule 14', () => {
    expect(SLOT_PERMISSIONS.reserved).toMatchObject({ time: true, format: false, remove: false });
    expect(SLOT_PERMISSIONS.scheduled).toMatchObject({ time: false, role: false });
    expect(SLOT_PERMISSIONS.skipped).toMatchObject({ skip: true, remove: true });
  });

  it('writes the summary line', () => {
    expect(slotSummaryLine({ total: 9, by_format: { reel: 3, story: 4, feed_post: 2 } }, 2)).toBe(
      '9 slots · 3 reels · 4 stories · 2 feed posts · 2 filled',
    );
  });

  it('spells out the account limit for a daily-limit error', () => {
    const account = {
      posting_rules: { min_gap_minutes: 120, max_feed_per_day: 2, max_stories_per_day: 5, max_revisions: 2 },
    };
    expect(
      planFieldText({ path: 'scheduled_at', code: 'exceeds_daily_limit', message: '' }, account, 'reel'),
    ).toBe('This would be the third feed post or reel that day. The account allows 2.');
  });
});
