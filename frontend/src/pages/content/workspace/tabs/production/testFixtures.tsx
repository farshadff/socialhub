/** Test data and helpers for the E06 panel (Production tab, library, shared asset components). */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Asset } from '@/services/socialhub/assets';
import type { ContentItemDetail } from '@/services/socialhub/content';
import type { FormatSpec, FormatsResponse } from '@/services/socialhub/formats';
import {
  ApiError,
  type ApiErrorBody,
  type Page,
} from '@/services/socialhub/http';
import type {
  Production,
  ProductionFrame,
  RenderTemplate,
} from '@/services/socialhub/production';

export const ACCOUNT = {
  id: 3,
  handle: 'brewlab',
  content_language: 'fa',
  timezone: 'Asia/Tehran',
};

/** What `useModel(name)` returns in these tests. */
export function modelFor(name: string) {
  if (name === 'account') {
    return {
      currentAccount: ACCOUNT,
      currentAccountId: 3,
      accounts: [ACCOUNT],
      loading: false,
      error: null,
      refreshAccounts: () => undefined,
    };
  }
  return { initialState: { currentUser: { access: 'admin' } } };
}

export function withQueryClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

export function apiError(
  status: number,
  body: Partial<ApiErrorBody> & { code: string },
) {
  return new ApiError(status, {
    message: body.code,
    request_id: 'req-1',
    fields: [],
    ...body,
  });
}

export function page<T>(results: T[]): Page<T> {
  return { count: results.length, next: null, previous: null, results };
}

const baseSpec = {
  aspect_tolerance: 0.01,
  min_width: 600,
  upload_mimes: [],
  pixel_format: null,
  audio_required: false,
  fps_min: null,
  fps_max: null,
  caption_allowed: true,
  caption_max_chars: 2200,
  max_hashtags: 5,
  alt_text_expected: true,
  alt_text_max_chars: 100,
  publish_method: 'api',
  capability: 'content_publish',
  daily_limit_group: 'feed',
  metric_checkpoints: [],
  evaluation_checkpoints: [],
};

export const reelSpec: FormatSpec = {
  ...baseSpec,
  format: 'reel',
  media_kind: 'video',
  label: 'Reel',
  layout: '9x16',
  width: 1080,
  height: 1920,
  aspect_ratio: '9:16',
  production_modes: ['motion', 'video'],
  default_production_mode: 'motion',
  image_mime: null,
  max_file_bytes: 100 * 1024 ** 2,
  min_duration_s: 5,
  max_duration_s: 90,
  container: 'mp4',
  video_codec: 'h264',
  audio_codec: 'aac',
  cover_required: true,
  safe_area: { top: 220, right: 120, bottom: 420, left: 0 },
};

export const feedSpec: FormatSpec = {
  ...baseSpec,
  format: 'feed_post',
  media_kind: 'image',
  label: 'Feed post',
  layout: '4x5',
  width: 1080,
  height: 1350,
  aspect_ratio: '4:5',
  production_modes: ['design'],
  default_production_mode: 'design',
  image_mime: 'image/jpeg',
  max_file_bytes: 8 * 1024 ** 2,
  min_duration_s: null,
  max_duration_s: null,
  container: null,
  video_codec: null,
  audio_codec: null,
  cover_required: false,
  safe_area: { top: 60, right: 60, bottom: 60, left: 60 },
};

export const formatsResponse: FormatsResponse = {
  registry_version: '1',
  formats: [
    {
      format: 'reel',
      label: 'Reel',
      media_kinds: ['video'],
      default_media_kind: 'video',
    },
    {
      format: 'feed_post',
      label: 'Feed post',
      media_kinds: ['image'],
      default_media_kind: 'image',
    },
  ],
  specs: [reelSpec, feedSpec],
  production_modes: [],
};

export const templates: RenderTemplate[] = [
  {
    key: 'title',
    name: 'Title',
    description:
      'Opening frame with a large headline and an optional line under it.',
    version: '1',
    layouts: ['4x5', '9x16'],
    image_slot: 'optional',
    fields: {
      headline: { required: true, max_chars: 60, max_lines: 3 },
      body: { required: false, max_chars: 120, max_lines: 3 },
    },
    preview_urls: {},
  },
  {
    key: 'stat',
    name: 'Stat',
    description: 'One number and what it means.',
    version: '1',
    layouts: ['4x5', '9x16'],
    image_slot: 'none',
    fields: {
      headline: { required: true, max_chars: 12, max_lines: 1 },
      body: { required: true, max_chars: 100, max_lines: 3 },
    },
    preview_urls: {},
  },
];

export function frame(
  overrides: Partial<ProductionFrame> = {},
): ProductionFrame {
  return {
    index: 1,
    shot_index: 1,
    template: 'title',
    headline: 'سه نشانه که بودجه‌تان نشتی دارد',
    body: '',
    visual_prompt: 'Soft morning light on a tidy desk, no people',
    background_asset_id: null,
    duration_seconds: 4,
    transition: 'cut',
    asset_id: 812,
    state: 'rendered',
    input_hash: 'c41d',
    warnings: [],
    overridden: [],
    asset: {
      id: 812,
      url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      thumbnail_url: null,
      width: 1080,
      height: 1920,
    },
    background_asset: null,
    script_frame: null,
    ...overrides,
  };
}

export function production(overrides: Partial<Production> = {}): Production {
  return {
    content_item: 42,
    version: 3,
    latest_version: 3,
    is_current: true,
    status: 'draft',
    origin: 'pipeline',
    format: 'reel',
    media_kind: 'video',
    production_mode: 'motion',
    render_status: 'ready',
    script: { id: 77, version: 2, status: 'approved', is_current: true },
    change_note: 'Produced from script version 2',
    frames: [
      frame(),
      frame({
        index: 2,
        shot_index: 2,
        template: 'stat',
        headline: '۶۰٪',
        body: 'از خریدها',
        transition: 'fade',
        asset_id: 813,
      }),
    ],
    final_asset: {
      id: 845,
      kind: 'video',
      mime: 'video/mp4',
      url: 'data:video/mp4;base64,AAAA',
      thumbnail_url: null,
      width: 1080,
      height: 1920,
      duration_ms: 20000,
      bytes: 5893120,
      rights_status: 'cleared',
    },
    cover_asset: null,
    cover_frame_index: 1,
    music_asset: null,
    shots: [],
    clips: [],
    missing_shots: [],
    caption: 'بودجه‌تان هر ماه زودتر از حقوق تمام می‌شود؟',
    hashtags: ['مدیریت_مالی'],
    alt_text: '',
    caption_preview:
      'بودجه‌تان هر ماه زودتر از حقوق تمام می‌شود؟\n\n#مدیریت_مالی',
    caption_length: 58,
    copy_limits: {
      caption_max_chars: 2200,
      max_hashtags: 5,
      alt_text_max_chars: 100,
    },
    uses_ai_generated: false,
    render_warnings: [],
    production_steps: {
      prepare: { status: 'done' },
      backgrounds: { status: 'done' },
      frames: { status: 'done' },
      assemble: { status: 'done' },
      copy: { status: 'done' },
      finish: { status: 'done' },
    },
    submitted_at: null,
    submitted_by: null,
    active_job: null,
    actions: {
      can_start: true,
      can_render: true,
      can_edit_frames: true,
      can_edit_copy: true,
      can_upload_final: true,
      can_submit: true,
      submit_blockers: [],
      holding_warnings: [],
    },
    versions: [
      {
        version: 3,
        status: 'draft',
        origin: 'pipeline',
        is_current: true,
        change_note: 'Produced from script version 2',
        created_at: '2026-11-24T09:30:02Z',
        submitted_at: null,
      },
      {
        version: 1,
        status: 'draft',
        origin: 'pipeline',
        is_current: false,
        change_note: 'Produced from script version 1',
        created_at: '2026-11-22T09:30:02Z',
        submitted_at: null,
      },
    ],
    ...overrides,
  };
}

/** A production resource for an item with no version yet. */
export function noVersion(overrides: Partial<Production> = {}): Production {
  return production({
    version: null,
    latest_version: null,
    status: null,
    origin: null,
    frames: [],
    final_asset: null,
    caption: '',
    hashtags: [],
    caption_preview: '',
    caption_length: 0,
    production_steps: {},
    versions: [],
    ...overrides,
  });
}

export function contentItem(
  overrides: Partial<ContentItemDetail> = {},
): ContentItemDetail {
  return {
    id: 42,
    account: 3,
    title: 'Three signs your budget is leaking',
    format: 'reel',
    media_kind: 'video',
    production_mode: 'motion',
    role: 'educate',
    status: 'in_production',
    hold_reason: '',
    needs_attention: false,
    revision_count: 0,
    plan: null,
    slot: null,
    candidate: null,
    active_job: null,
    thumbnail_url: null,
    publication: null,
    created_at: '2026-11-20T09:00:00Z',
    updated_at: '2026-11-24T09:30:02Z',
    cancelled_reason: '',
    current_brief: null,
    current_script: null,
    current_version: null,
    latest_check: null,
    open_review_task: null,
    allowed_actions: [],
    created_by: null,
    ...overrides,
  };
}

export function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 311,
    account: 3,
    content_item: null,
    kind: 'image',
    role: 'background',
    url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    thumbnail_url: null,
    original_filename: 'Rooftop Sunset.JPG',
    mime: 'image/jpeg',
    bytes: 2483112,
    width: 4000,
    height: 3000,
    duration_ms: null,
    checksum: '9f2c',
    origin: 'uploaded',
    rights_status: 'cleared',
    license_note: 'Shot in-house by our team',
    source_url: '',
    rights_expires_at: null,
    meta: {},
    in_use: false,
    created_by: { id: 2, name: 'Sara' },
    created_at: '2026-11-23T08:14:02Z',
    updated_at: '2026-11-23T08:14:02Z',
    ...overrides,
  };
}
