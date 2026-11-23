/**
 * Production (E06-S02 to E06-S07): the production resource, render templates, frames, clips,
 * generated images, copy, final-asset upload and submission.
 */
import {
  type Asset,
  appendFields,
  type AssetOrigin,
  postMultipart,
  type RightsStatus,
} from './assets';
import { api, type Page } from './http';
import type { ItemStatus, UserRef } from './content';
import type { Format, FrameTemplateKey, MediaKind, ProductionMode, ShotType } from './formats';
import type { Job, JobSummary } from './jobs';
import type { Transition } from './scripts';

export type VersionStatus = 'draft' | 'submitted' | 'passed' | 'rejected';
export type VersionOrigin = 'pipeline' | 'manual_upload';
export type RenderStatus = 'pending' | 'rendering' | 'ready' | 'failed';
export type FrameState = 'pending' | 'rendered' | 'stale' | 'failed';
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'waiting' | 'failed';
export type StepKey = 'prepare' | 'backgrounds' | 'frames' | 'assemble' | 'copy' | 'finish';

export type RenderWarning = {
  code: string;
  message?: string;
  frame_index?: number;
  shot_index?: number;
  asset_id?: number;
  field?: string;
};

export type FrameAsset = {
  id: number;
  url: string;
  thumbnail_url: string | null;
  width: number;
  height: number;
};

export type BackgroundAssetRef = {
  id: number;
  thumbnail_url: string | null;
  origin: AssetOrigin;
  rights_status: RightsStatus;
  url?: string;
  license_note?: string;
  rights_expires_at?: string | null;
};

export type ScriptFrameValues = {
  template: FrameTemplateKey;
  headline: string;
  body: string;
  duration_seconds: number;
  transition: Transition;
};

export type EditableFrameField =
  | 'template'
  | 'headline'
  | 'body'
  | 'background_asset_id'
  | 'duration_seconds'
  | 'transition';

export type ProductionFrame = {
  index: number;
  shot_index: number;
  template: FrameTemplateKey;
  headline: string;
  body: string;
  visual_prompt: string;
  background_asset_id: number | null;
  duration_seconds: number;
  transition: Transition;
  render_options?: { text_backdrop: boolean; logo_variant: 'auto' | 'light' | 'dark' };
  asset_id: number | null;
  state: FrameState;
  input_hash: string | null;
  warnings: RenderWarning[];
  overridden: EditableFrameField[];
  asset: FrameAsset | null;
  background_asset: BackgroundAssetRef | null;
  script_frame: ScriptFrameValues | null;
};

export type MediaAssetRef = {
  id: number;
  kind?: 'image' | 'video' | 'audio';
  mime?: string;
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_ms?: number | null;
  bytes?: number;
  rights_status?: RightsStatus;
  license_note?: string;
  rights_expires_at?: string | null;
  original_filename?: string;
};

export type ProductionShot = {
  index: number;
  type: ShotType;
  duration_seconds: number;
  description: string;
  asset_hint: string;
  frame_indexes: number[];
};

export type ClipState = 'ok' | 'padded';

export type ProductionClip = {
  shot_index: number;
  asset: {
    id: number;
    original_filename: string;
    duration_ms: number;
    width: number | null;
    height: number | null;
    thumbnail_url: string | null;
    rights_status: RightsStatus;
    url?: string;
  };
  start_ms: number;
  shot_duration_ms: number;
  usable_ms: number;
  state: ClipState;
};

export type SubmitBlocker =
  | 'not_current'
  | 'not_draft'
  | 'not_rendered'
  | 'waiting_for_backgrounds'
  | 'waiting_for_clips'
  | 'caption_missing'
  | 'cover_missing'
  | 'newer_script'
  | 'brief_not_approved';

export type ProductionActions = {
  can_start: boolean;
  can_render: boolean;
  can_edit_frames: boolean;
  can_edit_copy: boolean;
  can_upload_final: boolean;
  can_submit: boolean;
  submit_blockers: SubmitBlocker[];
  holding_warnings: string[];
};

export type ProductionVersionEntry = {
  version: number;
  status: VersionStatus;
  origin: VersionOrigin;
  is_current: boolean;
  change_note: string;
  created_at: string;
  submitted_at: string | null;
};

export type ProductionStep = {
  status: StepStatus;
  input_hash?: string;
  finished_at?: string;
  error_code?: string | null;
  [key: string]: unknown;
};

export type CopyLimits = {
  caption_max_chars: number;
  max_hashtags: number;
  alt_text_max_chars: number;
};

export type Production = {
  content_item: number;
  version: number | null;
  latest_version: number | null;
  is_current: boolean;
  status: VersionStatus | null;
  origin: VersionOrigin | null;
  format: Format;
  media_kind: MediaKind;
  production_mode: ProductionMode;
  render_status: RenderStatus;
  script: { id: number; version: number; status: string; is_current: boolean } | null;
  change_note: string;
  frames: ProductionFrame[];
  final_asset: MediaAssetRef | null;
  cover_asset: MediaAssetRef | null;
  cover_frame_index: number | null;
  music_asset: MediaAssetRef | null;
  shots: ProductionShot[];
  clips: ProductionClip[];
  missing_shots: number[];
  caption: string;
  hashtags: string[];
  alt_text: string;
  caption_preview: string;
  caption_length: number;
  hashtag_count?: number;
  disclosure_required?: boolean;
  copy_limits: CopyLimits;
  uses_ai_generated: boolean;
  render_warnings: RenderWarning[];
  production_steps: Partial<Record<StepKey, ProductionStep>>;
  submitted_at: string | null;
  submitted_by: UserRef | null;
  active_job: JobSummary | null;
  actions: ProductionActions;
  versions: ProductionVersionEntry[];
};

const base = (itemId: number) => `/content-items/${itemId}`;

export const getProduction = (itemId: number, version?: number) =>
  api.get<Production>(`${base(itemId)}/production/`, { version });

export type StartProductionResponse =
  | { job: Job }
  | { job: null; content_version: number; unchanged: true };

export const startProduction = (itemId: number, restartFromScript = false) =>
  api.post<StartProductionResponse>(`${base(itemId)}/production/start/`, {
    restart_from_script: restartFromScript,
  });

export const renderProduction = (
  itemId: number,
  body: { base_version: number; frames: number[] | null; reassemble?: boolean },
) => api.post<{ job: Job }>(`${base(itemId)}/production/render/`, body);

export const updateProductionSettings = (
  itemId: number,
  body: { base_version: number; music_asset_id?: number | null; cover_frame_index?: number },
) => api.patch<Production>(`${base(itemId)}/production/`, body);

export type FrameChange = Partial<{
  template: FrameTemplateKey;
  headline: string;
  body: string;
  background_asset_id: number | null;
  duration_seconds: number;
  transition: Transition;
}>;

export const updateFrame = (
  itemId: number,
  index: number,
  body: FrameChange & { base_version: number },
) => api.put<Production>(`${base(itemId)}/production/frames/${index}/`, body);

export const updateClips = (
  itemId: number,
  body: {
    base_version: number;
    clips: { shot_index: number; asset_id: number; start_ms: number }[];
  },
) => api.put<Production>(`${base(itemId)}/production/clips/`, body);

export const generateFrameImage = (
  itemId: number,
  body: {
    base_version: number;
    frame_index: number;
    prompt?: string | null;
    attach?: boolean;
    rerender?: boolean;
  },
) => api.post<{ job: Job }>(`${base(itemId)}/production/generate-image/`, body);

export const generateCopy = (
  itemId: number,
  body: { base_version: number; feedback?: string; keep_hashtags?: boolean },
) => api.post<{ job: Job }>(`${base(itemId)}/copy/generate/`, body);

export const saveCopy = (
  itemId: number,
  body: { base_version: number; caption: string; hashtags: string[]; alt_text: string },
) => api.put<Production>(`${base(itemId)}/copy/`, body);

export type FinalAssetInput = {
  base_version?: number | null;
  file?: File;
  asset_id?: number;
  origin?: 'uploaded' | 'licensed';
  rights_status?: RightsStatus;
  license_note?: string;
  source_url?: string;
  rights_expires_at?: string | null;
  cover?: File;
  cover_asset_id?: number;
};

export function uploadFinalAsset(
  itemId: number,
  input: FinalAssetInput,
  onProgress?: (percent: number) => void,
): Promise<Production> {
  const form = new FormData();
  const { file, cover, ...fields } = input;
  if (file) form.append('file', file);
  if (cover) form.append('cover', cover);
  appendFields(form, fields);
  return postMultipart<Production>(
    `${base(itemId)}/production/final-asset/`,
    form,
    onProgress,
  );
}

export type SubmitResponse = {
  content_item: { id: number; status: ItemStatus; active_job: JobSummary | null };
  version: number;
  status: VersionStatus;
  submitted_at: string;
  submitted_by: UserRef | null;
  submit_trigger: 'submission' | 'revision';
};

export const submitVersion = (
  itemId: number,
  body: { base_version: number; acknowledge_warnings: boolean },
) => api.post<SubmitResponse>(`${base(itemId)}/production/submit/`, body);

// Render templates (E06-S02)

export type ImageSlot = 'none' | 'optional' | 'required';

export type TemplateField = {
  required: boolean;
  max_chars: number;
  max_lines: number;
  items?: { min: number; max: number; max_chars: number };
};

export type RenderTemplate = {
  key: FrameTemplateKey;
  name: string;
  description: string;
  version: string;
  layouts: ('4x5' | '9x16')[];
  image_slot: ImageSlot;
  fields: { headline: TemplateField; body: TemplateField };
  preview_urls: Partial<Record<'4x5' | '9x16', string>>;
};

export const listRenderTemplates = (format?: Format) =>
  api.get<Page<RenderTemplate>>('/render-templates/', { format });

/** Generated backgrounds of an item, for the "Earlier images" row (E06-S05). */
export type GeneratedImage = Asset;

// Brand defaults for the Copy card's "brand" marker (E06-S06). Only the field the panel reads.
export type BrandHashtags = { default_hashtags: string[] };

export const getBrand = (accountId: number) =>
  api.get<BrandHashtags>(`/accounts/${accountId}/brand/`);
