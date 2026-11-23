/** Calendar and publication controls (E08). Shapes follow the E08 story contracts. */
import type { Format, Role } from './formats';
import { api, type Page } from './http';
import { withAccount } from '@/utils/accountRequest';

export type PublicationStatus =
  | 'scheduled'
  | 'publishing'
  | 'verifying'
  | 'published'
  | 'failed'
  | 'cancelled';
export type PublicationAction =
  | 'reschedule'
  | 'cancel'
  | 'publish_now'
  | 'retry'
  | 'mark_published';

export type PublicationAsset = {
  id: number;
  kind: 'image' | 'video' | 'audio';
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  url: string;
};

export type PublishAttempt = {
  id: number;
  number: number;
  provider: string;
  started_at: string;
  finished_at: string | null;
  outcome: string;
  error_code: string | null;
  error_message: string | null;
  verification?: {
    checks?: {
      at: string;
      method: string;
      container_status?: string;
      result: string;
    }[];
    final_check_pending?: boolean;
  } | null;
};

export type Publication = {
  id: number;
  account: number;
  content_item: { id: number; title: string; status: string; role?: Role | null };
  slot: { id: number; scheduled_at: string; status: string } | null;
  content_version: {
    id: number;
    version: number;
    caption: string;
    hashtags: string[];
    final_asset: PublicationAsset | null;
    cover_asset: PublicationAsset | null;
  };
  format: Format;
  delivery: 'provider' | 'manual';
  scheduled_at: string | null;
  status: PublicationStatus;
  blocked_reason: string | null;
  in_flight: boolean;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  full_caption: string;
  remote_container_id: string | null;
  container_status: string | null;
  container_created_at?: string | null;
  remote_media_id: string | null;
  remote_shortcode: string | null;
  permalink: string | null;
  published_at: string | null;
  published_via: string | null;
  next_metrics_checkpoint: string | null;
  next_metrics_at: string | null;
  allowed_actions: PublicationAction[];
  attempts?: PublishAttempt[];
  created_at: string;
  updated_at: string;
};

export type CalendarEntry = {
  kind: 'slot' | 'publication';
  at: string;
  date: string;
  format: Format;
  slot: {
    id: number;
    scheduled_at: string;
    status: string;
    role?: Role | null;
  } | null;
  content_item: { id: number; title: string; status: string; role?: Role | null } | null;
  publication: {
    id: number;
    status: PublicationStatus;
    delivery: 'provider' | 'manual';
    scheduled_at: string | null;
    published_at: string | null;
    blocked_reason: string | null;
    in_flight: boolean;
    attempt_count: number;
    next_attempt_at: string | null;
    permalink: string | null;
    thumbnail_url: string | null;
    allowed_actions: PublicationAction[];
  } | null;
};

export type CalendarData = {
  account: number;
  timezone: string;
  from: string;
  to: string;
  publishing_enabled: boolean;
  posting_rules: {
    min_gap_minutes: number;
    max_feed_per_day: number;
    max_stories_per_day: number;
    max_revisions: number;
  };
  days: { date: string; feed_count: number; story_count: number }[];
  entries: CalendarEntry[];
};

export const listPublications = (params: {
  status?: PublicationStatus[];
  format?: Format[];
  delivery?: 'provider' | 'manual';
  blocked?: boolean;
  content_item?: number;
  from?: string;
  to?: string;
  ordering?: 'scheduled_at' | '-scheduled_at' | 'published_at' | '-published_at';
  page?: number;
  page_size?: number;
}) => api.get<Page<Publication>>('/publications/', withAccount(params));

export const getPublication = (publicationId: number | string) =>
  api.get<Publication>(`/publications/${publicationId}/`);

export const getCalendar = (params: { from: string; to: string }) =>
  api.get<CalendarData>('/calendar/', withAccount(params));

export const reschedulePublication = (
  publicationId: number | string,
  body: { scheduled_at: string } | { slot: number },
) => api.post<Publication>(`/publications/${publicationId}/reschedule/`, body);

export const cancelPublication = (publicationId: number | string, reason: string) =>
  api.post<Publication>(`/publications/${publicationId}/cancel/`, { reason });

export const publishNow = (publicationId: number | string) =>
  api.post<Publication>(`/publications/${publicationId}/publish-now/`, {}, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });

export const retryPublication = (publicationId: number | string) =>
  api.post<Publication>(`/publications/${publicationId}/retry/`, {}, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });

export const markPublicationPublished = (
  publicationId: number | string,
  body: { permalink: string; published_at?: string; verify?: boolean },
) => api.post<{
  publication: Publication;
  found: boolean;
  checked: boolean;
}>(`/publications/${publicationId}/mark-published/`, body);
