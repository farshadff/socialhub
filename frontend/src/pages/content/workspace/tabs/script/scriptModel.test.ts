import { describe, expect, it } from 'vitest';
import type { ScriptPackage } from '@/services/socialhub/scripts';
import { FALLBACK_FRAME_TEMPLATES, FALLBACK_SCRIPT_RULES } from './constants';
import {
  computeIssues,
  deleteShot,
  derive,
  type EditorContext,
  emptyPackage,
  fromPayload,
  type IssueContext,
  issueText,
  moveFrame,
  moveShot,
  targetIds,
  toPayload,
  updateFrame,
  updateShot,
} from './scriptModel';
import { feedPostPackage, reelMotionPackage } from './testFixtures';

const rule = (format: string, media: string, mode: string) => {
  const found = FALLBACK_SCRIPT_RULES.find(
    (r) => r.format === format && r.media_kind === media && r.production_mode === mode,
  );
  if (!found) throw new Error('no rule');
  return found;
};

const motion: EditorContext = { mode: 'motion', isImage: false };
const video: EditorContext = { mode: 'video', isImage: false };
const image: EditorContext = { mode: 'design', isImage: true };

const reelMotion: IssueContext = {
  ...motion,
  rule: rule('reel', 'video', 'motion'),
  templates: FALLBACK_FRAME_TEMPLATES,
  role: 'educate',
  briefCta: 'Save the checklist',
};

const codes = (payload: ScriptPackage, ctx: IssueContext) =>
  computeIssues(payload, ctx).map((issue) => `${issue.code}@${issue.path}`);

describe('renumbering and cascade', () => {
  it('drags frame 4 before frame 2: indices renumber, text moves, total unchanged (AC 8)', () => {
    const pkg = derive(fromPayload(reelMotionPackage()), motion);
    const moved = derive(moveFrame(pkg, 3, 1), motion);
    expect(moved.frames.map((f) => f.index)).toEqual([1, 2, 3, 4, 5]);
    expect(moved.frames.map((f) => f.headline)).toEqual([
      'Posting every day is not why accounts grow.',
      'Plan the week, not the day.',
      '3×',
      'What matters more',
      'Save this checklist',
    ]);
    // The moved frame joins shot 2, so shot durations update and shot order stays valid.
    expect(moved.frames.map((f) => f.shot_index)).toEqual([1, 2, 2, 3, 5]);
    expect(moved.shots.map((s) => s.duration_seconds)).toEqual([4, 13, 8, 0, 5]);
    expect(moved.duration_seconds).toBe(30);
    expect(codes(toPayload(moved, motion), reelMotion)).toContain('frame_count@shots.3');
  });

  it('moving a shot keeps its frames and renumbers shot_index', () => {
    const pkg = derive(fromPayload(reelMotionPackage()), motion);
    const moved = derive(moveShot(pkg, 4, 0), motion);
    expect(moved.shots.map((s) => s.description)[0]).toBe('Closing card with the CTA.');
    expect(moved.shots.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
    expect(moved.frames[0].headline).toBe('Save this checklist');
    expect(moved.frames.map((f) => f.shot_index)).toEqual([1, 2, 3, 4, 5]);
  });

  it('deleting a shot deletes its frames and renumbers the rest (AC 9)', () => {
    const start = derive(fromPayload(reelMotionPackage()), motion);
    // Give shot 2 a second frame first.
    const withTwo = derive(updateFrame(start, start.frames[2].key, { shotKey: start.shots[1].key }), motion);
    expect(withTwo.frames.filter((f) => f.shot_index === 2)).toHaveLength(2);
    const after = derive(deleteShot(withTwo, withTwo.shots[1].key), motion);
    expect(after.shots).toHaveLength(4);
    expect(after.frames).toHaveLength(3);
    expect(after.shots.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    expect(after.frames.map((f) => [f.index, f.shot_index])).toEqual([
      [1, 1],
      [2, 3],
      [3, 4],
    ]);
  });

  it('round-trips a valid package without changes and strips editor keys', () => {
    const payload = reelMotionPackage();
    const out = toPayload(fromPayload(payload), motion);
    expect(out).toEqual(payload);
    expect(Object.keys(out.frames[0])).not.toContain('shotKey');
  });
});

describe('duration roll-ups', () => {
  it('motion: a shot lasts as long as its frames; total is the sum of shots', () => {
    const pkg = derive(fromPayload(reelMotionPackage()), motion);
    const longer = derive(updateFrame(pkg, pkg.frames[0].key, { duration_seconds: 6 }), motion);
    expect(longer.shots[0].duration_seconds).toBe(6);
    expect(longer.duration_seconds).toBe(32);
    // Shot durations typed in motion mode are overwritten by the roll-up.
    const typed = derive(updateShot(longer, longer.shots[1].key, { duration_seconds: 99 }), motion);
    expect(typed.shots[1].duration_seconds).toBe(6);
  });

  it('video: shot durations are edited and frames are capped at their shot', () => {
    const payload = reelMotionPackage();
    const pkg = derive(fromPayload(payload), video);
    const shorter = derive(updateShot(pkg, pkg.shots[2].key, { duration_seconds: 3 }), video);
    expect(shorter.shots[2].duration_seconds).toBe(3);
    expect(shorter.frames[2].duration_seconds).toBe(3);
    expect(shorter.duration_seconds).toBe(25);
  });

  it('image: durations 0, transition cut, hidden graphic shot mirrors the frame', () => {
    const pkg = derive(fromPayload(feedPostPackage()), image);
    const edited = derive(updateFrame(pkg, pkg.frames[0].key, { headline: 'A new line', transition: 'fade' }), image);
    const out = toPayload(edited, image);
    expect(out.duration_seconds).toBe(0);
    expect(out.frames[0].transition).toBe('cut');
    expect(out.shots).toEqual([
      expect.objectContaining({ type: 'graphic', duration_seconds: 0, description: 'A new line' }),
    ]);
    const prompted = derive(
      updateFrame(edited, edited.frames[0].key, { visual_prompt: 'Soft morning light on a desk' }),
      image,
    );
    expect(prompted.shots[0].description).toBe('Soft morning light on a desk');
  });
});

describe('emptyPackage', () => {
  it('reel motion: rule minimums, one frame per shot, last frame CTA, total within range', () => {
    const pkg = emptyPackage(rule('reel', 'video', 'motion'), motion);
    expect(pkg.shots).toHaveLength(4);
    expect(pkg.frames).toHaveLength(4);
    expect(pkg.frames.map((f) => f.shot_index)).toEqual([1, 2, 3, 4]);
    expect(pkg.frames[3].template).toBe('cta');
    expect(pkg.duration_seconds).toBeGreaterThanOrEqual(15);
  });

  it('reel video: footage shots reaching the minimum total, no frames', () => {
    const pkg = emptyPackage(rule('reel', 'video', 'video'), video);
    expect(pkg.shots).toHaveLength(3);
    expect(pkg.shots.every((s) => s.type === 'footage')).toBe(true);
    expect(pkg.frames).toHaveLength(0);
    expect(pkg.duration_seconds).toBe(15);
  });

  it('feed post: one hidden graphic shot and one frame (E05-S02 rule 19)', () => {
    const pkg = emptyPackage(rule('feed_post', 'image', 'design'), image);
    expect(pkg.shots).toEqual([expect.objectContaining({ type: 'graphic', duration_seconds: 0 })]);
    expect(pkg.frames).toHaveLength(1);
    expect(pkg.duration_seconds).toBe(0);
  });
});

describe('computeIssues', () => {
  it('a valid package has no issues', () => {
    expect(computeIssues(reelMotionPackage(), reelMotion)).toEqual([]);
    expect(
      computeIssues(feedPostPackage(), {
        ...image,
        rule: rule('feed_post', 'image', 'design'),
        templates: FALLBACK_FRAME_TEMPLATES,
        role: 'educate',
        briefCta: '',
      }),
    ).toEqual([]);
  });

  it('flags a headline over its template limit with limit and actual', () => {
    const payload = reelMotionPackage();
    payload.frames[0].headline = 'x'.repeat(80);
    const issues = computeIssues(payload, reelMotion);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'text_too_long', path: 'frames.0.headline', limit: 60, actual: 80 }),
    ]);
    expect(issueText(issues[0])).toBe('Frame 1 headline is 80 characters; the limit is 60.');
  });

  it('counts Unicode characters after trimming (Persian)', () => {
    const payload = reelMotionPackage();
    payload.frames[1].headline = '  ۳ برابر ذخیره  ';
    expect(codes(payload, reelMotion)).toEqual(['text_too_long@frames.1.headline']);
  });

  it('flags counts, durations, order, shot types and indices', () => {
    const payload = reelMotionPackage();
    payload.shots = payload.shots.slice(0, 3);
    payload.frames = payload.frames.slice(0, 3);
    payload.frames[2].shot_index = 1;
    payload.shots[0].type = 'footage';
    payload.shots[1].index = 7;
    const found = codes(payload, reelMotion);
    expect(found).toEqual(
      expect.arrayContaining([
        'shot_count@shots',
        'frame_count@frames',
        'index_sequence@shots.1.index',
        'frame_order@frames.2.shot_index',
        'duration_mismatch@duration_seconds',
        'shot_type_not_allowed@shots.0.type',
      ]),
    );
  });

  it('flags frame durations out of range and the total range', () => {
    const payload = reelMotionPackage();
    payload.frames[2].duration_seconds = 12;
    payload.shots[2].duration_seconds = 12;
    payload.duration_seconds = 34;
    expect(codes(payload, reelMotion)).toEqual(['frame_duration@frames.2.duration_seconds']);
    const short = reelMotionPackage();
    for (const s of short.shots) s.duration_seconds = 2;
    for (const f of short.frames) f.duration_seconds = 2;
    short.duration_seconds = 10;
    expect(codes(short, reelMotion)).toEqual(['duration_total@duration_seconds']);
  });

  it('video mode: footage required, asset hint required, frames no longer than the shot', () => {
    const payload = reelMotionPackage();
    const ctx: IssueContext = { ...reelMotion, ...video, rule: rule('reel', 'video', 'video') };
    expect(codes(payload, ctx)).toContain('footage_shot_required@shots');
    payload.shots[0].type = 'footage';
    payload.frames[0].duration_seconds = 5;
    const found = codes(payload, ctx);
    expect(found).toContain('text_required@shots.0.asset_hint');
    expect(found).toContain('frame_duration@frames.0.duration_seconds');
    expect(found).toContain('duration_mismatch@shots.0.duration_seconds');
    expect(found).not.toContain('footage_shot_required@shots');
  });

  it('flags list lines, required and text-asking visual prompts, and the CTA rule', () => {
    const payload = reelMotionPackage();
    payload.frames[2].body = 'Only one point';
    payload.frames[3].visual_prompt = '';
    payload.frames[1].visual_prompt = 'A desk with the brand logo';
    payload.frames[4].template = 'statement';
    payload.cta = '';
    expect(codes(payload, reelMotion)).toEqual(
      expect.arrayContaining([
        'list_lines@frames.2.body',
        'visual_prompt_required@frames.3.visual_prompt',
        'visual_prompt_asks_for_text@frames.1.visual_prompt',
        'cta_missing@cta',
        'cta_missing@frames.4.template',
      ]),
    );
    // Without the brief's CTA the CTA checks are skipped.
    expect(codes(payload, { ...reelMotion, briefCta: null })).not.toContain('cta_missing@cta');
  });

  it('a CTA as the only frame of an image format is not allowed unless the role is convert', () => {
    const payload = feedPostPackage();
    payload.frames[0].template = 'cta';
    const ctx: IssueContext = {
      ...image,
      rule: rule('feed_post', 'image', 'design'),
      templates: FALLBACK_FRAME_TEMPLATES,
      role: 'educate',
    };
    expect(codes(payload, ctx)).toContain('template_not_allowed@frames.0.template');
    expect(codes(payload, { ...ctx, role: 'convert' })).not.toContain(
      'template_not_allowed@frames.0.template',
    );
  });

  it('design notes: mood and layout required, at most six list items', () => {
    const payload = reelMotionPackage();
    payload.design_notes.mood = ' ';
    payload.design_notes.do = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(codes(payload, reelMotion)).toEqual([
      'text_required@design_notes.mood',
      'text_too_long@design_notes.do',
    ]);
  });
});

describe('field targets', () => {
  it('tries the most specific element first; image shot paths point at the frame headline', () => {
    expect(targetIds('frames.2.headline', false)).toEqual([
      'script-field-frames-2-headline',
      'script-field-frames-2',
      'script-field-frames',
    ]);
    expect(targetIds('shots.0.description', true)[0]).toBe('script-field-frames-0-headline');
  });
});
