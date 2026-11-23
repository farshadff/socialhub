import { describe, expect, it } from 'vitest';
import type {
  ContentItemSummary,
  ItemStatus,
} from '@/services/socialhub/content';
import {
  defaultTab,
  filtersToParams,
  filtersToRequest,
  groupForBoard,
  parseFilters,
  stepFor,
} from './logic';

const item = (id: number, status: ItemStatus, at: string | null = null) =>
  ({
    id,
    status,
    slot: at
      ? {
          id: id * 10,
          scheduled_at: at,
          format: 'reel',
          role: null,
          status: 'reserved',
        }
      : null,
  }) as unknown as ContentItemSummary;

describe('defaultTab', () => {
  it.each<[ItemStatus, string]>([
    ['selected', 'brief'],
    ['briefed', 'script'],
    ['scripted', 'production'],
    ['in_production', 'production'],
    ['needs_revision', 'production'],
    ['in_check', 'checks'],
    ['in_review', 'checks'],
    ['approved', 'publishing'],
    ['scheduled', 'publishing'],
    ['publishing', 'publishing'],
    ['failed', 'publishing'],
    ['published', 'performance'],
    ['cancelled', 'history'],
  ])('%s opens %s', (status, tab) => {
    expect(defaultTab(status)).toBe(tab);
  });
});

describe('stepFor', () => {
  it('marks the step in progress', () => {
    expect(stepFor('selected')).toEqual({ current: 1, status: 'process' });
    expect(stepFor('briefed')).toEqual({ current: 2, status: 'process' });
    expect(stepFor('in_production')).toEqual({ current: 3, status: 'process' });
    expect(stepFor('needs_revision')).toEqual({ current: 3, status: 'wait' });
    expect(stepFor('in_review')).toEqual({ current: 4, status: 'wait' });
    expect(stepFor('scheduled')).toEqual({ current: 5, status: 'process' });
    expect(stepFor('failed')).toEqual({ current: 5, status: 'error' });
    expect(stepFor('published')).toEqual({ current: 6, status: 'finish' });
  });
});

describe('groupForBoard', () => {
  const items = [
    item(1, 'in_review', '2026-11-30T10:00:00Z'),
    item(2, 'in_check', '2026-11-29T10:00:00Z'),
    item(3, 'needs_revision'),
    item(4, 'cancelled'),
    item(5, 'in_production', '2026-11-28T10:00:00Z'),
  ];

  it('puts shared statuses in one column, sorted by slot time, no-slot last', () => {
    const groups = groupForBoard(items, []);
    const byKey = Object.fromEntries(
      groups.map((g) => [g.column.key, g.items.map((i) => i.id)]),
    );
    expect(groups).toHaveLength(7);
    expect(byKey.check).toEqual([2, 1]);
    expect(byKey.production).toEqual([5, 3]);
    expect(Object.values(byKey).flat()).not.toContain(4);
  });

  it('adds the Cancelled column only when the filter asks for cancelled items', () => {
    const groups = groupForBoard(items, ['cancelled']);
    expect(groups).toHaveLength(8);
    expect(groups[7].column.title).toBe('Cancelled');
    expect(groups[7].items.map((i) => i.id)).toEqual([4]);
  });
});

describe('filters in the query string', () => {
  it('round-trips and drops bad values', () => {
    const parsed = parseFilters(
      new URLSearchParams(
        'plan=12&status=in_review,bogus&format=reel&role=none&attention=1&q=desk',
      ),
    );
    expect(parsed).toEqual({
      plan: 12,
      status: ['in_review'],
      format: ['reel'],
      role: 'none',
      needsAttention: true,
      search: 'desk',
    });
    const params = filtersToParams(parsed, new URLSearchParams('view=x'));
    expect(params.get('status')).toBe('in_review');
    expect(params.get('view')).toBe('x');
    expect(parseFilters(params)).toEqual(parsed);
  });

  it('leaves the plan unknown until a default is chosen, and keeps "all"', () => {
    expect(parseFilters(new URLSearchParams('')).plan).toBeNull();
    expect(parseFilters(new URLSearchParams('plan=all')).plan).toBe('all');
  });

  it('builds the list request', () => {
    expect(
      filtersToRequest(3, {
        plan: 'all',
        status: [],
        format: ['story'],
        role: null,
        needsAttention: false,
        search: '  ',
      }),
    ).toEqual({
      account: 3,
      plan: undefined,
      status: undefined,
      format: ['story'],
      role: undefined,
      needs_attention: undefined,
      search: undefined,
    });
  });
});
