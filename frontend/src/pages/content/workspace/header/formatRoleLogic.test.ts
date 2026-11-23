import { describe, expect, it } from 'vitest';
import { item, registry } from '../tabs/brief/testFixtures';
import {
  changedFields,
  consequenceOf,
  fillCombination,
  initialValues,
  isBookable,
  preselectSlot,
  slotMismatch,
} from './formatRoleLogic';

const label = (id: number) => `slot ${id}`;

describe('fillCombination (E04-S02 rule 8)', () => {
  it('moves a reel to an image story with the design mode', () => {
    expect(
      fillCombination(registry, { format: 'story', media_kind: 'video', production_mode: 'motion' }),
    ).toEqual({ format: 'story', media_kind: 'video', production_mode: 'motion' });
    expect(
      fillCombination(registry, { format: 'feed_post', media_kind: 'video', production_mode: 'motion' }),
    ).toEqual({ format: 'feed_post', media_kind: 'image', production_mode: 'design' });
  });

  it('gives an image story switched to video the motion mode (criterion 7)', () => {
    expect(
      fillCombination(registry, { format: 'story', media_kind: 'video', production_mode: 'design' }),
    ).toEqual({ format: 'story', media_kind: 'video', production_mode: 'motion' });
  });

  it('returns the input unchanged without a registry', () => {
    const values = { format: 'reel' as const, media_kind: 'image' as const, production_mode: 'design' as const };
    expect(fillCombination(undefined, values)).toBe(values);
  });
});

describe('consequenceOf', () => {
  it('warns that the brief and script are replaced when the format changes', () => {
    const it0 = item();
    const result = consequenceOf(it0, { ...initialValues(it0), format: 'story' }, label);
    expect(result).toEqual({
      type: 'warning',
      kind: 'brief',
      text: 'The brief (v1) and any script will be replaced. A new brief is written automatically.',
    });
  });

  it('warns only about the script when only the production mode changes', () => {
    const scripted = item({
      status: 'scripted',
      current_script: {
        id: 7,
        version: 2,
        status: 'approved',
        origin: 'ai',
        hook: 'h',
        duration_seconds: 30,
        frame_count: 5,
        shot_count: 5,
        created_at: '2026-11-22T10:00:00Z',
      },
    });
    expect(
      consequenceOf(scripted, { ...initialValues(scripted), production_mode: 'video' }, label),
    ).toMatchObject({ type: 'warning', text: 'The script (v2) will be replaced. The brief stays.' });
  });

  it('only informs when the slot alone changes', () => {
    const it0 = item();
    expect(consequenceOf(it0, { ...initialValues(it0), slot: 102 }, label)).toEqual({
      type: 'info',
      kind: 'slot',
      text: 'The item moves to slot 102. The brief and script stay.',
    });
  });

  it('says nothing when a role is set on an item without a brief', () => {
    const fresh = item({ status: 'selected', role: null, current_brief: null });
    expect(consequenceOf(fresh, { ...initialValues(fresh), role: 'engage' }, label)).toBeNull();
  });

  it('ignores superseded briefs', () => {
    const superseded = item({
      current_brief: { ...(item().current_brief as NonNullable<ReturnType<typeof item>['current_brief']>), status: 'superseded' },
    });
    expect(
      consequenceOf(superseded, { ...initialValues(superseded), role: 'engage' }, label),
    ).toBeNull();
  });
});

describe('changedFields', () => {
  it('sends only what changed', () => {
    const it0 = item();
    expect(changedFields(it0, { ...initialValues(it0), role: 'engage' })).toEqual({ role: 'engage' });
    expect(changedFields(it0, initialValues(it0))).toEqual({});
  });
});

describe('slots', () => {
  it('detects a slot of the old format', () => {
    expect(slotMismatch(item().slot, 'story')).toBe(true);
    expect(slotMismatch(item().slot, 'reel')).toBe(false);
    expect(slotMismatch(null, 'story')).toBe(false);
  });

  it('pre-selects the first slot whose role matches, else the earliest (rule 12)', () => {
    const options = [
      { id: 209, scheduled_at: '2099-12-01T06:30:00Z', role: null },
      { id: 205, scheduled_at: '2099-11-29T06:30:00Z', role: 'engage' as const },
      { id: 207, scheduled_at: '2099-11-28T06:30:00Z', role: 'attract' as const },
    ];
    expect(preselectSlot(options, 'engage')).toBe(205);
    expect(preselectSlot(options, 'educate')).toBe(207);
    expect(preselectSlot([], 'engage')).toBeNull();
  });

  it('only books slots at least 30 minutes ahead', () => {
    const now = Date.parse('2026-11-28T10:00:00Z');
    expect(isBookable('2026-11-28T10:29:00Z', now)).toBe(false);
    expect(isBookable('2026-11-28T10:30:00Z', now)).toBe(true);
  });
});
