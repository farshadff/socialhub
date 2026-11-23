/** Fixtures for the Brief tab, the format-and-role modal and the batch button tests. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Brief, BriefResource } from '@/services/socialhub/briefs';
import type { ContentItemDetail, PlanSlot } from '@/services/socialhub/content';
import type { FormatSpec, FormatsResponse } from '@/services/socialhub/formats';
import { ApiError, type ApiErrorBody } from '@/services/socialhub/http';

export const ACCOUNT = { id: 3, handle: 'brewlab', content_language: 'fa', timezone: 'UTC' };

export function modelFor(name: string) {
  if (name === 'account') return { currentAccount: ACCOUNT, currentAccountId: 3, loading: false };
  return { initialState: { currentUser: { access: 'admin' } } };
}

export function withQueryClient(node: React.ReactNode, client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

export function apiError(status: number, body: Partial<ApiErrorBody> & { code: string }) {
  return new ApiError(status, { message: body.code, request_id: 'req-1', fields: [], ...body });
}

const spec = (overrides: Partial<FormatSpec>): FormatSpec =>
  ({
    format: 'reel',
    media_kind: 'video',
    label: 'Reel',
    layout: '9x16',
    width: 1080,
    height: 1920,
    aspect_ratio: '9:16',
    aspect_tolerance: 0.01,
    min_width: 720,
    production_modes: ['motion', 'video'],
    default_production_mode: 'motion',
    image_mime: null,
    upload_mimes: ['video/mp4'],
    max_file_bytes: 104857600,
    min_duration_s: 5,
    max_duration_s: 90,
    container: 'mp4',
    video_codec: 'h264',
    pixel_format: 'yuv420p',
    audio_codec: 'aac',
    audio_required: true,
    fps_min: 23,
    fps_max: 60,
    caption_allowed: true,
    caption_max_chars: 2200,
    max_hashtags: 5,
    alt_text_expected: false,
    alt_text_max_chars: 100,
    cover_required: true,
    safe_area: { top: 220, right: 120, bottom: 420, left: 60 },
    publish_method: 'publish_reel',
    capability: 'publish_reel',
    daily_limit_group: 'feed',
    metric_checkpoints: ['1h'],
    evaluation_checkpoints: ['24h'],
    ...overrides,
  }) as FormatSpec;

export const registry: FormatsResponse = {
  registry_version: '1+h5',
  formats: [
    { format: 'feed_post', label: 'Feed post', media_kinds: ['image'], default_media_kind: 'image' },
    { format: 'story', label: 'Story', media_kinds: ['image', 'video'], default_media_kind: 'image' },
    { format: 'reel', label: 'Reel', media_kinds: ['video'], default_media_kind: 'video' },
  ],
  specs: [
    spec({
      format: 'feed_post',
      media_kind: 'image',
      label: 'Feed post',
      layout: '4x5',
      production_modes: ['design'],
      default_production_mode: 'design',
    }),
    spec({
      format: 'story',
      media_kind: 'image',
      label: 'Image story',
      production_modes: ['design'],
      default_production_mode: 'design',
    }),
    spec({ format: 'story', media_kind: 'video', label: 'Video story' }),
    spec({}),
  ],
  production_modes: [
    { key: 'design', label: 'Design', description: 'A single image rendered from a brand template.' },
    { key: 'motion', label: 'Motion', description: 'Rendered frames animated into a video with transitions.' },
    { key: 'video', label: 'Video', description: 'Uploaded footage cut to the script, with text overlays.' },
  ],
  roles: [
    {
      key: 'attract',
      label: 'Attract',
      purpose: 'Reach people who do not follow the account yet',
      guidance: '',
      examples: ['A surprising fact about the topic'],
      default_metric: 'reach',
      default_metric_story: 'reach',
    },
    {
      key: 'educate',
      label: 'Educate',
      purpose: 'Teach something useful enough to save',
      guidance: '',
      examples: ['Three steps to …'],
      default_metric: 'saves',
      default_metric_story: 'saves',
    },
    {
      key: 'build_trust',
      label: 'Build trust',
      purpose: 'Show proof, results or the people behind the brand',
      guidance: '',
      examples: [],
      default_metric: 'shares',
      default_metric_story: 'shares',
    },
    {
      key: 'convert',
      label: 'Convert',
      purpose: 'Move people to a concrete action',
      guidance: '',
      examples: [],
      default_metric: 'shares',
      default_metric_story: 'shares',
    },
    {
      key: 'engage',
      label: 'Engage',
      purpose: 'Start a conversation with the audience',
      guidance: '',
      examples: ['Which one would you choose?'],
      default_metric: 'comments',
      default_metric_story: 'replies',
    },
  ],
};

export function item(overrides: Partial<ContentItemDetail> = {}): ContentItemDetail {
  return {
    id: 42,
    account: 3,
    title: 'Five-minute desk setup',
    format: 'reel',
    media_kind: 'video',
    production_mode: 'motion',
    role: 'educate',
    status: 'briefed',
    hold_reason: '',
    needs_attention: false,
    revision_count: 0,
    cancelled_reason: '',
    plan: { id: 12, title: 'Week of 28 Nov', week_start: '2026-11-28', week_end: '2026-12-04', status: 'active' },
    slot: { id: 101, scheduled_at: '2099-11-28T15:30:00Z', format: 'reel', role: 'educate', status: 'reserved' },
    candidate: null,
    active_job: null,
    current_brief: {
      id: 88,
      version: 1,
      status: 'approved',
      origin: 'ai',
      role: 'educate',
      key_message: 'A tidy desk takes five minutes.',
      success_metric: 'saves',
      created_at: '2026-11-22T09:21:40Z',
    },
    current_script: null,
    current_version: null,
    latest_check: null,
    open_review_task: null,
    publication: null,
    thumbnail_url: null,
    allowed_actions: ['cancel', 'edit_format', 'generate_brief', 'edit_brief', 'approve_brief'],
    created_by: { id: 5, name: 'Sara' },
    created_at: '2026-11-22T09:20:11Z',
    updated_at: '2026-11-22T09:21:40Z',
    ...overrides,
  };
}

export function brief(overrides: Partial<Brief> = {}): Brief {
  return {
    id: 91,
    version: 2,
    role: 'educate',
    objective: 'Show home-office workers a desk reset they can repeat every evening.',
    key_message: 'A tidy desk takes five minutes if you follow the same four moves.',
    hook_direction: 'Open on a running five-minute timer over a cluttered desk.',
    audience_note: 'New homeowners working from home.',
    cta: 'Save this and try it tonight.',
    must_include: ['The four moves: clear, sort, wipe, reset'],
    must_avoid: [],
    references: [{ title: 'Why tidy desks are trending again', url: 'https://example.org/articles/tidy-desks' }],
    format_notes: 'Reel, motion mode, 20–30 seconds. One move per frame.',
    success_metric: 'saves',
    status: 'draft',
    origin: 'ai',
    feedback: '',
    ai_run: 3301,
    created_by: null,
    created_at: '2026-11-22T09:41:05Z',
    ...overrides,
  };
}

export function briefResource(overrides: Partial<BriefResource> = {}): BriefResource {
  const b = overrides.brief === undefined ? brief() : overrides.brief;
  return {
    content_item: 42,
    brief: b,
    latest_version: b?.version ?? 0,
    approved_version: 1,
    validation: { valid: true, issues: [] },
    warnings: [],
    actions: { can_generate: true, can_edit: true, can_approve: true },
    ...overrides,
  };
}

export function slot(overrides: Partial<PlanSlot>): PlanSlot {
  return {
    id: 205,
    plan: 12,
    scheduled_at: '2099-11-29T06:30:00Z',
    local_date: '2099-11-29',
    local_time: '10:00',
    weekday: 6,
    format: 'story',
    role: 'engage',
    status: 'open',
    note: '',
    content_item: null,
    ...overrides,
  };
}

export const page1 = <T,>(results: T[]) => ({ count: results.length, next: null, previous: null, results });
