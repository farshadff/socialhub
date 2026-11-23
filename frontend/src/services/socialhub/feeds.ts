/**
 * Feed sources and feed items (E03-S01). Types mirror the API JSON in the story.
 */
import { api, type Page } from './http';
import type { ItemStatus } from './content';
import type { Job } from './jobs';

export type FeedSourceKind = 'rss' | 'json_api' | 'manual';

export type FeedFieldPaths = {
  external_id: string;
  title: string;
  summary?: string;
  url?: string;
  image_url?: string;
  published_at?: string;
};

export type FeedSourceConfig = {
  auto_eligible: boolean;
  max_age_days: number;
  /** `json_api` only. */
  items_path?: string;
  fields?: FeedFieldPaths;
  auth_header_env?: string;
  /** Read-only: whether the named environment variable is set on the server. */
  auth_header_present?: boolean;
};

export type FeedItemStatus = 'new' | 'eligible' | 'ignored' | 'used';

export const FEED_ITEM_STATUSES: FeedItemStatus[] = [
  'new',
  'eligible',
  'ignored',
  'used',
];

export type FeedSource = {
  id: number;
  account: number;
  kind: FeedSourceKind;
  name: string;
  url: string;
  config: FeedSourceConfig;
  active: boolean;
  last_synced_at: string | null;
  /** `ok`, `empty` or `error:<code>`; null before the first sync. */
  last_status: string | null;
  item_counts: Record<FeedItemStatus, number>;
  created_at: string;
  updated_at: string;
};

export type FeedSourceInput = {
  account?: number;
  kind?: FeedSourceKind;
  name?: string;
  url?: string;
  config?: Partial<Omit<FeedSourceConfig, 'auth_header_present'>>;
  active?: boolean;
};

export type FeedItem = {
  id: number;
  account: number;
  source: { id: number; name: string; kind: FeedSourceKind };
  external_id: string;
  title: string;
  summary: string;
  url: string;
  image_url: string;
  published_at: string | null;
  status: FeedItemStatus;
  content_item: { id: number; status: ItemStatus } | null;
  created_at: string;
  updated_at: string;
};

export type FeedItemInput = {
  account?: number;
  title?: string;
  summary?: string;
  url?: string;
  image_url?: string;
  published_at?: string | null;
  status?: FeedItemStatus;
};

/** Result of a successful `feeds.sync` job. */
export type FeedSyncResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  eligible: number;
  status: string;
};

export const listFeedSources = (params: {
  account: number;
  kind?: FeedSourceKind[];
  active?: boolean;
  ordering?: 'name' | '-last_synced_at';
}) =>
  api.get<Page<FeedSource>>('/feeds/sources/', { ...params, page_size: 100 });

export const createFeedSource = (body: FeedSourceInput) =>
  api.post<FeedSource>('/feeds/sources/', body);

export const updateFeedSource = (id: number, body: FeedSourceInput) =>
  api.patch<FeedSource>(`/feeds/sources/${id}/`, body);

export const deleteFeedSource = (id: number) =>
  api.delete(`/feeds/sources/${id}/`);

export const syncFeedSource = (id: number) =>
  api.post<{ job: Job }>(`/feeds/sources/${id}/sync/`);

export type FeedItemListParams = {
  account: number;
  source?: number;
  status?: FeedItemStatus[];
  search?: string;
  published_after?: string;
  ordering?: '-published_at' | 'published_at' | '-created_at';
  page?: number;
  page_size?: number;
};

export const listFeedItems = (params: FeedItemListParams) =>
  api.get<Page<FeedItem>>('/feeds/items/', params);

export const createFeedItem = (body: FeedItemInput) =>
  api.post<FeedItem>('/feeds/items/', body);

export const updateFeedItem = (id: number, body: FeedItemInput) =>
  api.patch<FeedItem>(`/feeds/items/${id}/`, body);
