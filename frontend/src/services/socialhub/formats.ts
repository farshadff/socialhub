/**
 * Format registry (E04-S01), roles (E04-S02), script rules and frame templates (E05-S01).
 * `GET /formats/` is not account-scoped and is fetched once per session (see `useFormats`).
 */
import { api } from './http';

export type Format = 'reel' | 'story' | 'feed_post';
export type MediaKind = 'image' | 'video';
export type ProductionMode = 'design' | 'motion' | 'video';
export type Role = 'attract' | 'educate' | 'build_trust' | 'convert' | 'engage';
export type Metric =
  | 'reach'
  | 'views'
  | 'likes'
  | 'comments'
  | 'saves'
  | 'shares'
  | 'replies'
  | 'follower_growth';

export const FORMATS: Format[] = ['reel', 'story', 'feed_post'];
export const ROLES: Role[] = ['attract', 'educate', 'build_trust', 'convert', 'engage'];
export const METRICS: Metric[] = [
  'reach',
  'views',
  'likes',
  'comments',
  'saves',
  'shares',
  'replies',
  'follower_growth',
];

export type FormatInfo = {
  format: Format;
  label: string;
  media_kinds: MediaKind[];
  default_media_kind: MediaKind;
};

export type SafeArea = { top: number; right: number; bottom: number; left: number };

export type FormatSpec = {
  format: Format;
  media_kind: MediaKind;
  label: string;
  layout: '4x5' | '9x16';
  width: number;
  height: number;
  aspect_ratio: string;
  aspect_tolerance: number;
  min_width: number;
  production_modes: ProductionMode[];
  default_production_mode: ProductionMode;
  image_mime: string | null;
  upload_mimes: string[];
  max_file_bytes: number;
  min_duration_s: number | null;
  max_duration_s: number | null;
  container: string | null;
  video_codec: string | null;
  pixel_format: string | null;
  audio_codec: string | null;
  audio_required: boolean;
  fps_min: number | null;
  fps_max: number | null;
  caption_allowed: boolean;
  caption_max_chars: number;
  max_hashtags: number;
  alt_text_expected: boolean;
  alt_text_max_chars: number;
  cover_required: boolean;
  safe_area: SafeArea;
  publish_method: string;
  capability: string;
  daily_limit_group: string;
  metric_checkpoints: string[];
  evaluation_checkpoints: string[];
};

export type ProductionModeInfo = {
  key: ProductionMode;
  label: string;
  description: string;
};

export type RoleInfo = {
  key: Role;
  label: string;
  purpose: string;
  guidance: string;
  examples: string[];
  default_metric: Metric;
  default_metric_story: Metric;
};

export type Range = { min: number; max: number };

export type ShotType = 'footage' | 'graphic' | 'text';

export type ScriptRule = {
  format: Format;
  media_kind: MediaKind;
  production_mode: ProductionMode;
  shots: Range;
  frames: Range;
  duration_seconds: Range;
  /** Null in `video` mode, where a frame is limited by its shot instead. */
  frame_duration_seconds: Range | null;
  allowed_shot_types: ShotType[];
  frame_per_shot_required: boolean;
  last_frame_cta: boolean;
};

export type FrameTemplateKey =
  | 'title'
  | 'statement'
  | 'stat'
  | 'list'
  | 'quote'
  | 'image_caption'
  | 'cta';

export type FrameTemplate = {
  key: FrameTemplateKey;
  label: string;
  purpose: string;
  headline: Range;
  body: Range;
  visual_prompt: { required: boolean; max: number; min?: number };
  /** For `list`: the body is split into lines with these limits. */
  body_lines: { min: number; max: number; max_chars: number } | null;
};

export type FormatsResponse = {
  registry_version: string;
  formats: FormatInfo[];
  specs: FormatSpec[];
  production_modes: ProductionModeInfo[];
  roles?: RoleInfo[];
  script_rules?: ScriptRule[];
  frame_templates?: FrameTemplate[];
};

export const getFormats = () => api.get<FormatsResponse>('/formats/');

/** Panel labels for enums the API returns as stored values. */
export const METRIC_LABEL: Record<Metric, string> = {
  reach: 'Reach',
  views: 'Views',
  likes: 'Likes',
  comments: 'Comments',
  saves: 'Saves',
  shares: 'Shares',
  replies: 'Replies',
  follower_growth: 'Follower growth',
};

/** Fallback labels when the registry has not loaded (E04-S01 "Loading and error"). */
export const FORMAT_FALLBACK_LABEL: Record<Format, string> = {
  reel: 'Reel',
  story: 'Story',
  feed_post: 'Feed post',
};

export const ROLE_FALLBACK_LABEL: Record<Role, string> = {
  attract: 'Attract',
  educate: 'Educate',
  build_trust: 'Build trust',
  convert: 'Convert',
  engage: 'Engage',
};

export const MODE_FALLBACK_LABEL: Record<ProductionMode, string> = {
  design: 'Design',
  motion: 'Motion',
  video: 'Video',
};

/** E04-S03 rule 2: metrics a brief may use for a format and media kind. */
export function allowedMetrics(format: Format, mediaKind: MediaKind): Metric[] {
  return METRICS.filter((metric) => {
    if (metric === 'follower_growth') return false;
    if (metric === 'replies') return format === 'story';
    if (metric === 'views') return mediaKind === 'video';
    return true;
  });
}
