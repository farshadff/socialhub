/**
 * Pure functions behind the storyboard editor (E05-S02-FE1): the working package with stable row
 * keys, index renumbering, `shot_index` cascade, duration roll-ups per production mode, the empty
 * package for "Write script by hand", and client-side issues that mirror the server's
 * `validate_script_package` codes (E05-S01 rules 16–24 and the frame template limits).
 */
import type { ValidationIssue } from '@/services/socialhub/briefs';
import type {
  FrameTemplate,
  FrameTemplateKey,
  ProductionMode,
  Role,
  ScriptRule,
  ShotType,
} from '@/services/socialhub/formats';
import {
  type DesignNotes,
  SCRIPT_LIMITS,
  type ScriptFrame,
  type ScriptPackage,
  type Shot,
} from '@/services/socialhub/scripts';
import { FALLBACK_FRAME_TEMPLATES, TRANSITIONS, VISUAL_PROMPT_TEXT_WORDS } from './constants';

// ---------------------------------------------------------------------------------------------
// Working package

export type EditorShot = Shot & { key: string };
/** `shotKey` ties a frame to its shot across reorders; `shot_index` is derived from it. */
export type EditorFrame = ScriptFrame & { key: string; shotKey: string };

export type EditorPackage = Omit<ScriptPackage, 'shots' | 'frames'> & {
  shots: EditorShot[];
  frames: EditorFrame[];
};

/** What the roll-ups and checks need to know about the item. */
export type EditorContext = {
  mode: ProductionMode;
  /** Image formats: one frame, one hidden graphic shot, no durations or transitions. */
  isImage: boolean;
};

let keySeq = 0;
export const newKey = (prefix: string) => {
  keySeq += 1;
  return `${prefix}${keySeq}`;
};

const emptyDesignNotes = (): DesignNotes => ({
  mood: '',
  color_usage: '',
  typography: '',
  imagery_style: '',
  layout: '',
  do: [],
  dont: [],
});

const str = (value: unknown) => (typeof value === 'string' ? value : '');
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Loads an API package into the editor; tolerant of missing keys. */
export function fromPayload(payload: ScriptPackage): EditorPackage {
  const shots: EditorShot[] = (payload.shots ?? []).map((shot) => ({
    ...shot,
    description: str(shot.description),
    on_screen_text: str(shot.on_screen_text),
    voiceover: str(shot.voiceover),
    asset_hint: str(shot.asset_hint),
    duration_seconds: num(shot.duration_seconds),
    key: newKey('s'),
  }));
  const frames: EditorFrame[] = (payload.frames ?? []).map((frame) => {
    const shot = shots.find((s) => s.index === frame.shot_index);
    return {
      ...frame,
      headline: str(frame.headline),
      body: str(frame.body),
      visual_prompt: str(frame.visual_prompt),
      duration_seconds: num(frame.duration_seconds),
      transition: frame.transition ?? 'cut',
      key: newKey('f'),
      // An orphan keeps an empty key so validation can report `shot_ref_missing`.
      shotKey: shot?.key ?? '',
    };
  });
  const notes = payload.design_notes ?? emptyDesignNotes();
  return {
    scenario: str(payload.scenario),
    hook: str(payload.hook),
    duration_seconds: num(payload.duration_seconds),
    cta: str(payload.cta),
    music_hint: str(payload.music_hint),
    design_notes: {
      ...emptyDesignNotes(),
      ...notes,
      do: [...(notes.do ?? [])],
      dont: [...(notes.dont ?? [])],
    },
    shots,
    frames,
  };
}

/** Index renumbering (E05-S02 rule 17): indices follow screen order; `shot_index` follows the shot. */
export function renumber(pkg: EditorPackage): EditorPackage {
  const shots = pkg.shots.map((shot, i) => (shot.index === i + 1 ? shot : { ...shot, index: i + 1 }));
  const position = new Map(shots.map((shot) => [shot.key, shot.index]));
  const frames = pkg.frames.map((frame, i) => {
    const shotIndex = position.get(frame.shotKey) ?? frame.shot_index;
    return frame.index === i + 1 && frame.shot_index === shotIndex
      ? frame
      : { ...frame, index: i + 1, shot_index: shotIndex };
  });
  return { ...pkg, shots, frames };
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * Duration roll-ups (E05-S02 rules 18–19). Motion: a shot lasts as long as its frames. Video: shot
 * durations are edited and frames are capped at their shot. Image: every duration is 0, the one
 * hidden shot is a graphic whose description mirrors the frame. The package duration is always the
 * sum of the shots.
 */
export function rollUp(pkg: EditorPackage, ctx: EditorContext): EditorPackage {
  let { shots, frames } = pkg;
  if (ctx.isImage) {
    const frame = frames[0];
    const description = frame ? frame.visual_prompt.trim() || frame.headline.trim() : '';
    shots = shots.map((shot, i) => ({
      ...shot,
      type: 'graphic',
      duration_seconds: 0,
      description: i === 0 ? description : shot.description,
    }));
    frames = frames.map((f) => ({ ...f, duration_seconds: 0, transition: 'cut' }));
    return { ...pkg, shots, frames, duration_seconds: 0, music_hint: '' };
  }
  if (ctx.mode === 'motion') {
    shots = shots.map((shot) => {
      const total = sum(frames.filter((f) => f.shotKey === shot.key).map((f) => f.duration_seconds));
      return shot.duration_seconds === total ? shot : { ...shot, duration_seconds: total };
    });
  } else if (ctx.mode === 'video') {
    const limit = new Map(shots.map((shot) => [shot.key, shot.duration_seconds]));
    frames = frames.map((frame) => {
      const max = limit.get(frame.shotKey);
      return max !== undefined && frame.duration_seconds > max
        ? { ...frame, duration_seconds: max }
        : frame;
    });
  }
  return { ...pkg, shots, frames, duration_seconds: sum(shots.map((s) => s.duration_seconds)) };
}

/** Renumbering then roll-ups; run after every change. */
export const derive = (pkg: EditorPackage, ctx: EditorContext) => rollUp(renumber(pkg), ctx);

/** Keeps frames grouped by shot order (rule 17) with a stable sort; orphans stay in place. */
function sortFramesByShot(pkg: EditorPackage): EditorPackage {
  const position = new Map(pkg.shots.map((shot, i) => [shot.key, i]));
  const frames = pkg.frames
    .map((frame, i) => ({ frame, i, at: position.get(frame.shotKey) }))
    .sort((a, b) => {
      if (a.at === undefined || b.at === undefined) return a.i - b.i;
      return a.at - b.at || a.i - b.i;
    })
    .map((entry) => entry.frame);
  return { ...pkg, frames };
}

/** The API payload: derived values applied, editor keys removed. */
export function toPayload(pkg: EditorPackage, ctx: EditorContext): ScriptPackage {
  const derived = derive(pkg, ctx);
  return {
    scenario: derived.scenario,
    hook: derived.hook,
    duration_seconds: derived.duration_seconds,
    shots: derived.shots.map(({ key: _key, ...shot }) => shot),
    frames: derived.frames.map(({ key: _key, shotKey: _shotKey, ...frame }) => frame),
    design_notes: { ...derived.design_notes },
    cta: derived.cta,
    music_hint: derived.music_hint,
  };
}

/** Stable comparison for dirty tracking. */
export const samePayload = (a: ScriptPackage, b: ScriptPackage) =>
  JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------
// Edits (each returns a new package; callers run `derive` afterwards)

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

export function moveShot(pkg: EditorPackage, from: number, to: number): EditorPackage {
  return sortFramesByShot({ ...pkg, shots: move(pkg.shots, from, to) });
}

/**
 * Moves a frame. If the new position would break the shot order, the frame joins the shot of the
 * neighbour it passed (moving left: the frame now after it; moving right: the frame now before it).
 * Text and duration move with the frame, so the total duration does not change in motion mode.
 */
export function moveFrame(pkg: EditorPackage, from: number, to: number): EditorPackage {
  const frames = move(pkg.frames, from, to);
  if (frames === pkg.frames) return pkg;
  const position = new Map(pkg.shots.map((shot, i) => [shot.key, i]));
  const moved = frames[to];
  const prev = frames[to - 1];
  const next = frames[to + 1];
  const at = position.get(moved.shotKey);
  const prevAt = prev ? position.get(prev.shotKey) : undefined;
  const nextAt = next ? position.get(next.shotKey) : undefined;
  let shotKey = moved.shotKey;
  if (at !== undefined) {
    if (to < from && nextAt !== undefined && at > nextAt) shotKey = next.shotKey;
    else if (to > from && prevAt !== undefined && at < prevAt) shotKey = prev.shotKey;
  }
  if (shotKey !== moved.shotKey) frames[to] = { ...moved, shotKey };
  return { ...pkg, frames };
}

export function blankShot(type: ShotType, duration: number): EditorShot {
  return {
    key: newKey('s'),
    index: 0,
    duration_seconds: duration,
    type,
    description: '',
    on_screen_text: '',
    voiceover: '',
    asset_hint: '',
  };
}

export function blankFrame(
  shotKey: string,
  template: FrameTemplateKey,
  duration: number,
): EditorFrame {
  return {
    key: newKey('f'),
    shotKey,
    index: 0,
    shot_index: 0,
    template,
    headline: '',
    body: '',
    visual_prompt: '',
    duration_seconds: duration,
    transition: 'cut',
  };
}

export function addShot(pkg: EditorPackage, shot: EditorShot): EditorPackage {
  return { ...pkg, shots: [...pkg.shots, shot] };
}

/** Deletes a shot and, with it, every frame attached to it (rule 17). */
export function deleteShot(pkg: EditorPackage, key: string): EditorPackage {
  return {
    ...pkg,
    shots: pkg.shots.filter((shot) => shot.key !== key),
    frames: pkg.frames.filter((frame) => frame.shotKey !== key),
  };
}

/** Adds a frame after the last frame of its shot (or at the end). */
export function addFrame(pkg: EditorPackage, frame: EditorFrame): EditorPackage {
  const lastOfShot = pkg.frames.map((f) => f.shotKey).lastIndexOf(frame.shotKey);
  if (lastOfShot === -1) return sortFramesByShot({ ...pkg, frames: [...pkg.frames, frame] });
  const frames = [...pkg.frames];
  frames.splice(lastOfShot + 1, 0, frame);
  return { ...pkg, frames };
}

export function duplicateFrame(pkg: EditorPackage, key: string): EditorPackage {
  const at = pkg.frames.findIndex((frame) => frame.key === key);
  if (at === -1) return pkg;
  const frames = [...pkg.frames];
  frames.splice(at + 1, 0, { ...pkg.frames[at], key: newKey('f') });
  return { ...pkg, frames };
}

export function deleteFrame(pkg: EditorPackage, key: string): EditorPackage {
  return { ...pkg, frames: pkg.frames.filter((frame) => frame.key !== key) };
}

export function updateShot(
  pkg: EditorPackage,
  key: string,
  patch: Partial<Omit<EditorShot, 'key' | 'index'>>,
): EditorPackage {
  return {
    ...pkg,
    shots: pkg.shots.map((shot) => (shot.key === key ? { ...shot, ...patch } : shot)),
  };
}

/** Changing a frame's shot regroups frames by shot; changing its template keeps its text (rule 21). */
export function updateFrame(
  pkg: EditorPackage,
  key: string,
  patch: Partial<Omit<EditorFrame, 'key' | 'index' | 'shot_index'>>,
): EditorPackage {
  const next = {
    ...pkg,
    frames: pkg.frames.map((frame) => (frame.key === key ? { ...frame, ...patch } : frame)),
  };
  return patch.shotKey !== undefined ? sortFramesByShot(next) : next;
}

// ---------------------------------------------------------------------------------------------
// "Write script by hand"

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * An empty package with the rule's minimum number of shots and frames (E05-S02 "Write script by
 * hand"). Motion: one frame per shot, durations that reach the minimum total. Video: footage shots
 * that reach the minimum total, frames only if the rule requires them. Image: one hidden graphic
 * shot and one frame (rule 19).
 */
export function emptyPackage(rule: ScriptRule, ctx: EditorContext): EditorPackage {
  const base: EditorPackage = {
    scenario: '',
    hook: '',
    duration_seconds: 0,
    cta: '',
    music_hint: '',
    design_notes: emptyDesignNotes(),
    shots: [],
    frames: [],
  };
  if (ctx.isImage) {
    const shot = blankShot('graphic', 0);
    return derive({ ...base, shots: [shot], frames: [blankFrame(shot.key, 'title', 0)] }, ctx);
  }
  const shotCount = Math.max(rule.shots.min, 1);
  const frameCount =
    ctx.mode === 'motion' ? Math.max(rule.frames.min, shotCount) : Math.max(rule.frames.min, 0);
  const shotType: ShotType =
    ctx.mode === 'video' && rule.allowed_shot_types.includes('footage')
      ? 'footage'
      : (rule.allowed_shot_types.find((t) => t !== 'footage') ?? 'graphic');
  const minTotal = rule.duration_seconds.min;

  if (ctx.mode === 'motion') {
    const range = rule.frame_duration_seconds ?? { min: 2, max: 8 };
    const each = clamp(Math.ceil(minTotal / frameCount), range.min, range.max);
    const shots = Array.from({ length: shotCount }, () => blankShot(shotType, 0));
    const frames = Array.from({ length: frameCount }, (_, i) => {
      const shot = shots[Math.min(i, shotCount - 1)];
      const isLast = i === frameCount - 1;
      const template: FrameTemplateKey =
        i === 0 ? 'title' : isLast && rule.last_frame_cta ? 'cta' : 'statement';
      return blankFrame(shot.key, template, each);
    });
    return derive({ ...base, shots, frames }, ctx);
  }

  const each = Math.max(Math.ceil(minTotal / shotCount), 1);
  const shots = Array.from({ length: shotCount }, () => blankShot(shotType, each));
  const frames = Array.from({ length: frameCount }, (_, i) =>
    blankFrame(shots[Math.min(i, shotCount - 1)].key, i === 0 ? 'title' : 'statement', 1),
  );
  return derive({ ...base, shots, frames }, ctx);
}

// ---------------------------------------------------------------------------------------------
// Client-side issues

export type IssueContext = EditorContext & {
  rule: ScriptRule;
  templates: FrameTemplate[];
  role?: Role | null;
  /** The approved brief's CTA; `null` when unknown, which skips the CTA checks. */
  briefCta?: string | null;
};

/** Rule 22: Unicode characters after trimming; a line break counts as one. */
export const charCount = (value: string) => [...value.replace(/\r\n/g, '\n').trim()].length;

export const templateFor = (templates: FrameTemplate[], key: string): FrameTemplate | undefined =>
  templates.find((t) => t.key === key) ?? FALLBACK_FRAME_TEMPLATES.find((t) => t.key === key);

function textIssues(
  issues: ValidationIssue[],
  path: string,
  value: string,
  range: { min: number; max: number },
) {
  const actual = charCount(value);
  if (range.min > 0 && actual === 0) {
    issues.push({ code: 'text_required', path, message: '', limit: range.min, actual });
  } else if (actual < range.min) {
    issues.push({ code: 'text_too_short', path, message: '', limit: range.min, actual });
  } else if (actual > range.max) {
    issues.push({ code: 'text_too_long', path, message: '', limit: range.max, actual });
  }
}

export function asksForText(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return VISUAL_PROMPT_TEXT_WORDS.some((word) => {
    if (/^[a-z]+$/.test(word)) return new RegExp(`\\b${word}\\b`).test(lower);
    return lower.includes(word);
  });
}

/** Mirrors `validate_script_package` (E05-S01 rules 16–24). Paths are zero-based. */
export function computeIssues(payload: ScriptPackage, ctx: IssueContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { rule, templates, mode, isImage } = ctx;
  const { shots, frames } = payload;
  const range = (min: number, max: number) => ({ min, max });
  const L = SCRIPT_LIMITS;

  // Counts.
  if (shots.length < rule.shots.min || shots.length > rule.shots.max) {
    const limit = shots.length < rule.shots.min ? rule.shots.min : rule.shots.max;
    issues.push({ code: 'shot_count', path: 'shots', message: '', limit, actual: shots.length });
  }
  if (frames.length < rule.frames.min || frames.length > rule.frames.max) {
    const limit = frames.length < rule.frames.min ? rule.frames.min : rule.frames.max;
    issues.push({ code: 'frame_count', path: 'frames', message: '', limit, actual: frames.length });
  }

  // Index integrity (rules 16–17).
  shots.forEach((shot, i) => {
    if (shot.index !== i + 1) {
      issues.push({ code: 'index_sequence', path: `shots.${i}.index`, message: '' });
    }
  });
  let lastShotIndex = 0;
  frames.forEach((frame, i) => {
    if (frame.index !== i + 1) {
      issues.push({ code: 'index_sequence', path: `frames.${i}.index`, message: '' });
    }
    if (!shots.some((shot) => shot.index === frame.shot_index)) {
      issues.push({ code: 'shot_ref_missing', path: `frames.${i}.shot_index`, message: '' });
    } else if (frame.shot_index < lastShotIndex) {
      issues.push({ code: 'frame_order', path: `frames.${i}.shot_index`, message: '' });
    }
    lastShotIndex = Math.max(lastShotIndex, frame.shot_index);
  });

  // Durations (rule 18) and per-frame limits.
  if (!isImage) {
    const shotTotal = sum(shots.map((s) => s.duration_seconds));
    const frameTotal = sum(frames.map((f) => f.duration_seconds));
    if (payload.duration_seconds !== shotTotal) {
      issues.push({
        code: 'duration_mismatch',
        path: 'duration_seconds',
        message: '',
        limit: shotTotal,
        actual: payload.duration_seconds,
      });
    } else if (mode === 'motion' && frameTotal !== shotTotal) {
      issues.push({
        code: 'duration_mismatch',
        path: 'duration_seconds',
        message: '',
        limit: shotTotal,
        actual: frameTotal,
      });
    }
    const total = rule.duration_seconds;
    if (payload.duration_seconds < total.min || payload.duration_seconds > total.max) {
      issues.push({
        code: 'duration_total',
        path: 'duration_seconds',
        message: '',
        limit: payload.duration_seconds < total.min ? total.min : total.max,
        actual: payload.duration_seconds,
      });
    }
    frames.forEach((frame, i) => {
      const shot = shots.find((s) => s.index === frame.shot_index);
      const perFrame = rule.frame_duration_seconds;
      const min = perFrame ? perFrame.min : 1;
      const max = perFrame ? perFrame.max : (shot?.duration_seconds ?? Number.POSITIVE_INFINITY);
      if (frame.duration_seconds < min || frame.duration_seconds > max) {
        issues.push({
          code: 'frame_duration',
          path: `frames.${i}.duration_seconds`,
          message: '',
          limit: frame.duration_seconds < min ? min : max,
          actual: frame.duration_seconds,
        });
      }
    });
    if (mode === 'video') {
      shots.forEach((shot, j) => {
        const used = sum(
          frames.filter((f) => f.shot_index === shot.index).map((f) => f.duration_seconds),
        );
        if (used > shot.duration_seconds) {
          issues.push({
            code: 'duration_mismatch',
            path: `shots.${j}.duration_seconds`,
            message: '',
            limit: shot.duration_seconds,
            actual: used,
          });
        }
      });
    }
    if (rule.frame_per_shot_required) {
      shots.forEach((shot, j) => {
        if (!frames.some((f) => f.shot_index === shot.index)) {
          issues.push({
            code: 'frame_count',
            path: `shots.${j}`,
            message: '',
            limit: 1,
            actual: 0,
          });
        }
      });
    }
  }

  // Shot types (rule 19).
  shots.forEach((shot, i) => {
    if (!rule.allowed_shot_types.includes(shot.type)) {
      issues.push({ code: 'shot_type_not_allowed', path: `shots.${i}.type`, message: '' });
    }
  });
  if (mode === 'video' && !shots.some((shot) => shot.type === 'footage')) {
    issues.push({ code: 'footage_shot_required', path: 'shots', message: '' });
  }

  // Templates and transitions (rule 20).
  frames.forEach((frame, i) => {
    const template = templateFor(templates, frame.template);
    const ctaAlone =
      isImage && frames.length === 1 && frame.template === 'cta' && ctx.role !== 'convert';
    if (!template || ctaAlone) {
      issues.push({ code: 'template_not_allowed', path: `frames.${i}.template`, message: '' });
    }
    if (!TRANSITIONS.includes(frame.transition)) {
      issues.push({ code: 'template_not_allowed', path: `frames.${i}.transition`, message: '' });
    }
  });

  // CTA (rule 21).
  if (ctx.briefCta?.trim()) {
    if (!payload.cta.trim()) issues.push({ code: 'cta_missing', path: 'cta', message: '' });
    const last = frames[frames.length - 1];
    if (rule.last_frame_cta && mode === 'motion' && last && last.template !== 'cta') {
      issues.push({
        code: 'cta_missing',
        path: `frames.${frames.length - 1}.template`,
        message: '',
      });
    }
  }

  // Text limits (rule 22 and "Other field limits").
  textIssues(issues, 'scenario', payload.scenario, L.scenario);
  textIssues(issues, 'hook', payload.hook, L.hook);
  textIssues(issues, 'cta', payload.cta, L.cta);
  textIssues(issues, 'music_hint', payload.music_hint, isImage ? range(0, 0) : L.music_hint);
  shots.forEach((shot, i) => {
    textIssues(issues, `shots.${i}.description`, shot.description, L.shot_description);
    textIssues(issues, `shots.${i}.on_screen_text`, shot.on_screen_text, L.shot_on_screen_text);
    textIssues(issues, `shots.${i}.voiceover`, shot.voiceover, L.shot_voiceover);
    textIssues(
      issues,
      `shots.${i}.asset_hint`,
      shot.asset_hint,
      shot.type === 'footage' ? range(5, L.shot_asset_hint.max) : L.shot_asset_hint,
    );
  });
  frames.forEach((frame, i) => {
    const template = templateFor(templates, frame.template);
    if (!template) return;
    textIssues(issues, `frames.${i}.headline`, frame.headline, template.headline);
    if (template.body_lines) {
      const lines = frame.body.replace(/\r\n/g, '\n').trim().split('\n');
      const count = frame.body.trim() ? lines.length : 0;
      const { min, max, max_chars } = template.body_lines;
      const badLine = lines.some((line) => {
        const n = charCount(line);
        return n < 1 || n > max_chars;
      });
      if (count < min || count > max) {
        issues.push({
          code: 'list_lines',
          path: `frames.${i}.body`,
          message: '',
          limit: count < min ? min : max,
          actual: count,
        });
      } else if (badLine) {
        issues.push({
          code: 'list_lines',
          path: `frames.${i}.body`,
          message: '',
          limit: max_chars,
          actual: Math.max(...lines.map(charCount)),
        });
      }
    } else {
      textIssues(issues, `frames.${i}.body`, frame.body, template.body);
    }
    const vp = template.visual_prompt;
    const vpPath = `frames.${i}.visual_prompt`;
    const vpLength = charCount(frame.visual_prompt);
    if (vp.required && vpLength === 0) {
      issues.push({ code: 'visual_prompt_required', path: vpPath, message: '' });
    } else if (vpLength > 0 && vp.min && vpLength < vp.min) {
      issues.push({
        code: 'text_too_short',
        path: vpPath,
        message: '',
        limit: vp.min,
        actual: vpLength,
      });
    } else if (vpLength > Math.min(vp.max, L.visual_prompt.max)) {
      issues.push({
        code: 'text_too_long',
        path: vpPath,
        message: '',
        limit: Math.min(vp.max, L.visual_prompt.max),
        actual: vpLength,
      });
    }
    if (vpLength > 0 && asksForText(frame.visual_prompt)) {
      issues.push({ code: 'visual_prompt_asks_for_text', path: vpPath, message: '' });
    }
  });

  const notes = payload.design_notes;
  const note = L.design_note.max;
  textIssues(issues, 'design_notes.mood', notes.mood, range(1, note));
  textIssues(issues, 'design_notes.color_usage', notes.color_usage, range(0, note));
  textIssues(issues, 'design_notes.typography', notes.typography, range(0, note));
  textIssues(issues, 'design_notes.imagery_style', notes.imagery_style, range(0, note));
  textIssues(issues, 'design_notes.layout', notes.layout, range(1, note));
  for (const list of ['do', 'dont'] as const) {
    const items = notes[list];
    if (items.length > L.design_list_items) {
      issues.push({
        code: 'text_too_long',
        path: `design_notes.${list}`,
        message: '',
        limit: L.design_list_items,
        actual: items.length,
      });
    }
    items.forEach((value, i) => {
      textIssues(issues, `design_notes.${list}.${i}`, value, range(1, L.design_list_item_chars));
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------------------------
// Issue text and field targets

const TOP_LABEL: Record<string, string> = {
  scenario: 'Scenario',
  hook: 'Hook',
  cta: 'Call to action',
  music_hint: 'Music hint',
  duration_seconds: 'Total duration',
};

const ITEM_LABEL: Record<string, string> = {
  description: 'description',
  on_screen_text: 'on-screen text',
  voiceover: 'voiceover note',
  asset_hint: 'asset hint',
  type: 'type',
  duration_seconds: 'duration',
  headline: 'headline',
  body: 'body',
  visual_prompt: 'background image description',
  template: 'template',
  transition: 'transition',
  shot_index: 'shot',
  index: 'position',
};

const NOTE_LABEL: Record<string, string> = {
  mood: 'Mood',
  color_usage: 'Colour use',
  typography: 'Typography',
  imagery_style: 'Imagery style',
  layout: 'Layout',
  do: 'Do',
  dont: "Don't",
};

/** The shot or frame a path belongs to: "Frame 3", "Shot 2" (image formats: "Frame"). */
function ownerLabel(path: string, isImage: boolean): string | null {
  const [head, second] = path.split('.');
  if ((head !== 'frames' && head !== 'shots') || !/^\d+$/.test(second ?? '')) return null;
  if (isImage) return 'Frame';
  return `${head === 'frames' ? 'Frame' : 'Shot'} ${Number(second) + 1}`;
}

/** "Frame 3 headline", "Shot 2 description", "Design notes: Mood", "Hook". */
export function fieldLabel(path: string, isImage = false): string {
  const [head, second, third] = path.split('.');
  const owner = ownerLabel(path, isImage);
  if (owner) {
    if (isImage && head === 'shots') return 'Frame headline';
    return third ? `${owner} ${ITEM_LABEL[third] ?? third}` : owner;
  }
  if (head === 'design_notes' && second) {
    const label = NOTE_LABEL[second] ?? second;
    return third !== undefined
      ? `Design notes: ${label} item ${Number(third) + 1}`
      : `Design notes: ${label}`;
  }
  if (head === 'shots') return 'Shots';
  if (head === 'frames') return 'Frames';
  return TOP_LABEL[head] ?? path;
}

const atLeastOrMost = (actual: number | undefined, limit: number | undefined) =>
  actual !== undefined && limit !== undefined && actual < limit ? 'at least' : 'at most';

/** English text for an issue, built from its code so client and server issues read the same. */
export function issueText(issue: ValidationIssue, isImage = false): string {
  const where = fieldLabel(issue.path, isImage);
  const owner = ownerLabel(issue.path, isImage) ?? where;
  const { limit, actual } = issue;
  const hasNumbers = limit !== undefined && actual !== undefined;
  switch (issue.code) {
    case 'shot_count':
      return hasNumbers
        ? `The script has ${actual} shots; this format needs ${atLeastOrMost(actual, limit)} ${limit}.`
        : 'The number of shots does not fit this format.';
    case 'frame_count':
      if (issue.path.startsWith('shots.')) return `${owner} has no frame. Add one or delete the shot.`;
      return hasNumbers
        ? `The script has ${actual} frames; this format needs ${atLeastOrMost(actual, limit)} ${limit}.`
        : 'The number of frames does not fit this format.';
    case 'duration_total':
      return hasNumbers
        ? `Total duration is ${actual} s; this format needs ${atLeastOrMost(actual, limit)} ${limit} s.`
        : 'Total duration does not fit this format.';
    case 'duration_mismatch':
      if (issue.path.startsWith('shots.')) {
        return hasNumbers
          ? `The frames of ${owner.toLowerCase()} last ${actual} s, longer than the shot (${limit} s).`
          : `The frames of ${owner.toLowerCase()} last longer than the shot.`;
      }
      return hasNumbers
        ? `Durations don't add up: ${actual} s against ${limit} s.`
        : "Durations don't add up.";
    case 'frame_duration':
      return hasNumbers
        ? `${owner} lasts ${actual} s; it must be ${atLeastOrMost(actual, limit)} ${limit} s.`
        : `${owner} duration is out of range.`;
    case 'index_sequence':
      return `${owner} is out of sequence.`;
    case 'shot_ref_missing':
      return `${owner} is attached to a shot that doesn't exist.`;
    case 'frame_order':
      return `${owner} comes after a frame of a later shot.`;
    case 'shot_type_not_allowed':
      return `${where} isn't allowed in this production mode.`;
    case 'template_not_allowed':
      return `${where} isn't allowed for this format.`;
    case 'text_required':
      return `${where} is required.`;
    case 'text_too_long':
      return hasNumbers
        ? `${where} is ${actual} characters; the limit is ${limit}.`
        : `${where} is too long.`;
    case 'text_too_short':
      return hasNumbers
        ? `${where} is ${actual} characters; it needs at least ${limit}.`
        : `${where} is too short.`;
    case 'list_lines':
      return `${where} needs 2–5 points, one per line, each at most 45 characters.`;
    case 'visual_prompt_required':
      return `${where} is required for this template.`;
    case 'visual_prompt_asks_for_text':
      return `${where} asks for text, letters or logos in the image. Templates draw all text.`;
    case 'cta_missing':
      return issue.path === 'cta'
        ? 'Call to action is required because the brief has one.'
        : 'The last frame must use the CTA template because the brief has a call to action.';
    case 'footage_shot_required':
      return 'Add at least one footage shot.';
    default:
      return issue.message || `${where} needs attention.`;
  }
}

/** DOM id of the input that edits `path` (zero-based dotted path without `payload.`). */
export const fieldDomId = (path: string) => `script-field-${path.replace(/\./g, '-')}`;

/** Strips the `payload.` prefix the API uses on PUT and approve field errors. */
export const stripPayload = (path: string) => path.replace(/^payload\./, '');

/**
 * The element ids to try for a path, most specific first. Image formats keep the shot hidden, so
 * shot paths point at the frame's headline.
 */
export function targetIds(path: string, isImage: boolean): string[] {
  let normalized = path;
  if (isImage && /^shots(\.|$)/.test(path)) normalized = 'frames.0.headline';
  const parts = normalized.split('.');
  const ids: string[] = [];
  for (let n = parts.length; n > 0; n -= 1) ids.push(fieldDomId(parts.slice(0, n).join('.')));
  return ids;
}
