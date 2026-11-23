/** Scripts and storyboards (E05-S01, E05-S02, E05-S03). */
import { api, type Page } from './http';
import type { ItemStatus, ScriptStatus, UserRef } from './content';
import type { FrameTemplateKey, ShotType } from './formats';
import type { Validation } from './briefs';
import type { Job, JobSummary } from './jobs';

export type Transition = 'cut' | 'fade' | 'slide';

export type Shot = {
  index: number;
  duration_seconds: number;
  type: ShotType;
  description: string;
  on_screen_text: string;
  voiceover: string;
  asset_hint: string;
};

export type ScriptFrame = {
  index: number;
  shot_index: number;
  template: FrameTemplateKey;
  headline: string;
  body: string;
  visual_prompt: string;
  duration_seconds: number;
  transition: Transition;
};

export type DesignNotes = {
  mood: string;
  color_usage: string;
  typography: string;
  imagery_style: string;
  layout: string;
  do: string[];
  dont: string[];
};

export type ScriptPackage = {
  scenario: string;
  hook: string;
  duration_seconds: number;
  shots: Shot[];
  frames: ScriptFrame[];
  design_notes: DesignNotes;
  cta: string;
  music_hint: string;
};

export type ScriptActions = {
  can_generate: boolean;
  can_edit: boolean;
  can_approve: boolean;
};

export type ScriptResource = {
  content_item: number;
  version: number;
  latest_version: number;
  approved_version: number | null;
  status: ScriptStatus;
  origin: 'ai' | 'human';
  feedback: string;
  brief_version: number;
  brief_is_current: boolean;
  ai_run: number | null;
  created_by: UserRef | null;
  created_at: string;
  payload: ScriptPackage;
  validation: Validation;
  actions: ScriptActions;
  /** Only on the `PUT` response. */
  unchanged?: boolean;
};

const base = (itemId: number) => `/content-items/${itemId}/script`;

/** `404 not_found` with `details.reason = "no_script"` when the item has none yet. */
export const getScript = (itemId: number) =>
  api.get<ScriptResource>(`${base(itemId)}/`);

export type GenerateScriptBody = {
  feedback?: string;
  base_version?: number;
  /** Write a fresh script from the brief; feedback is direction only, no previous package. */
  start_over?: boolean;
};

export const generateScript = (itemId: number, body: GenerateScriptBody = {}) =>
  api.post<{ job: Job }>(`${base(itemId)}/generate/`, body);

export const saveScript = (
  itemId: number,
  body: { base_version: number; note?: string; payload: ScriptPackage },
) => api.put<ScriptResource>(`${base(itemId)}/`, body);

export type ApproveScriptResponse = {
  script: ScriptResource;
  content_item: { id: number; status: ItemStatus; active_job: JobSummary | null };
};

export const approveScript = (itemId: number, version: number) =>
  api.post<ApproveScriptResponse>(`${base(itemId)}/approve/`, { version });

export type ScriptVersionSource = 'operator' | 'autopilot' | 'qc_revise';

export type ScriptVersionEntry = {
  version: number;
  status: ScriptStatus;
  origin: 'ai' | 'human';
  source: ScriptVersionSource;
  feedback: string;
  brief_version: number;
  is_latest: boolean;
  valid: boolean;
  summary: {
    hook: string;
    frame_count: number;
    shot_count: number;
    duration_seconds: number;
  };
  created_by: UserRef | null;
  created_at: string;
};

export const listScriptVersions = (itemId: number) =>
  api.get<Page<ScriptVersionEntry>>(`${base(itemId)}/versions/`);

export const getScriptVersion = (itemId: number, version: number) =>
  api.get<ScriptResource>(`${base(itemId)}/versions/${version}/`);

/** E05-S01 "Other field limits". */
export const SCRIPT_LIMITS = {
  scenario: { min: 20, max: 1200 },
  hook: { min: 5, max: 140 },
  cta: { min: 0, max: 120 },
  music_hint: { min: 0, max: 120 },
  shot_description: { min: 5, max: 300 },
  shot_on_screen_text: { min: 0, max: 120 },
  shot_voiceover: { min: 0, max: 300 },
  shot_asset_hint: { min: 0, max: 200 },
  visual_prompt: { min: 0, max: 400 },
  design_note: { min: 0, max: 300 },
  design_list_items: 6,
  design_list_item_chars: 120,
  note: 500,
  feedback: 2000,
} as const;
