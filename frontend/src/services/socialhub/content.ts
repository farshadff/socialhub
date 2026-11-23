/**
 * Content items (E03-S04), item settings (E04-S02) and the plan reads the workspace needs.
 * Types mirror the API JSON in the story specs.
 */
import { api, type Page } from './http';
import type { Format, MediaKind, Metric, ProductionMode, Role } from './formats';
import type { JobSummary } from './jobs';

export type ItemStatus =
  | 'selected'
  | 'briefed'
  | 'scripted'
  | 'in_production'
  | 'in_check'
  | 'needs_revision'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

/** Pipeline order (E03-S04), used for sorting and filters. */
export const ITEM_STATUSES: ItemStatus[] = [
  'selected',
  'briefed',
  'scripted',
  'in_production',
  'needs_revision',
  'in_check',
  'in_review',
  'approved',
  'scheduled',
  'publishing',
  'failed',
  'published',
  'cancelled',
];

export type UserRef = { id: number; name: string };

export type SlotStatus = 'open' | 'reserved' | 'scheduled' | 'published' | 'skipped';

export type SlotRef = {
  id: number;
  scheduled_at: string;
  format: Format;
  role: Role | null;
  status: SlotStatus;
};

export type PlanRef = {
  id: number;
  title: string;
  week_start: string;
  week_end?: string;
  status?: 'draft' | 'active' | 'closed';
};

export type CandidateKind = 'trend' | 'feed_item' | 'repurpose';

export type CandidateSummary = { id: number; kind: CandidateKind; total_score: string };

export type CandidateDetail = CandidateSummary & {
  title: string;
  summary?: string;
  rationale?: string;
  sources?: { title: string; url: string }[];
  evidence_score?: number;
  goal_fit_score?: number;
  freshness_score?: number;
  rank: number | null;
};

export type PublicationSummary = {
  id: number;
  status: string;
  scheduled_at: string | null;
  blocked_reason?: string;
  attempt_count?: number;
  permalink: string | null;
  published_at?: string | null;
};

export type ContentItemSummary = {
  id: number;
  account: number;
  title: string;
  format: Format;
  media_kind: MediaKind;
  production_mode: ProductionMode;
  role: Role | null;
  status: ItemStatus;
  hold_reason: string;
  needs_attention: boolean;
  revision_count: number;
  plan: PlanRef | null;
  slot: SlotRef | null;
  candidate: CandidateSummary | null;
  active_job: JobSummary | null;
  thumbnail_url: string | null;
  publication: PublicationSummary | null;
  created_at: string;
  updated_at: string;
};

export type BriefStatus = 'draft' | 'approved' | 'superseded';
export type DocOrigin = 'ai' | 'human';

export type BriefSummary = {
  id: number;
  version: number;
  status: BriefStatus;
  origin: DocOrigin;
  role: Role;
  key_message: string;
  success_metric: Metric;
  created_at: string;
};

export type ScriptStatus = 'draft' | 'approved' | 'superseded';

export type ScriptSummary = {
  id: number;
  version: number;
  status: ScriptStatus;
  origin: DocOrigin;
  hook: string;
  duration_seconds: number;
  frame_count: number;
  shot_count: number;
  created_at: string;
};

export type VersionAssetRef = {
  id: number;
  url: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  duration_ms: number | null;
};

export type ContentVersionSummary = {
  id: number;
  version: number;
  status: string;
  render_status: string;
  origin: string;
  caption: string;
  hashtags: string[];
  final_asset: VersionAssetRef | null;
  cover_asset: VersionAssetRef | null;
};

export type ItemAction =
  | 'cancel'
  | 'edit_format'
  | 'generate_brief'
  | 'edit_brief'
  | 'approve_brief'
  | 'generate_script'
  | 'edit_script'
  | 'approve_script'
  | (string & {});

export type ContentItemDetail = Omit<ContentItemSummary, 'candidate'> & {
  cancelled_reason: string;
  candidate: CandidateDetail | null;
  current_brief: BriefSummary | null;
  current_script: ScriptSummary | null;
  current_version: ContentVersionSummary | null;
  latest_check: {
    id: number;
    attempt: number;
    status: string;
    outcome: string | null;
    summary: string;
    completed_at: string | null;
  } | null;
  auto_revision_count?: number;
  open_review_task: { id: number; reason: string; detail: string; created_at: string } | null;
  allowed_actions: ItemAction[];
  created_by: UserRef | null;
};

export type ItemListParams = {
  account: number;
  plan?: number;
  status?: ItemStatus[];
  format?: Format[];
  role?: (Role | 'none')[];
  production_mode?: ProductionMode[];
  needs_attention?: boolean;
  has_active_job?: boolean;
  slot_from?: string;
  slot_to?: string;
  search?: string;
  ordering?: 'slot_time' | '-slot_time' | '-updated_at' | '-created_at' | 'status';
  page?: number;
  page_size?: number;
};

export const listContentItems = (params: ItemListParams) =>
  api.get<Page<ContentItemSummary>>('/content-items/', params);

export const getContentItem = (id: number | string) =>
  api.get<ContentItemDetail>(`/content-items/${id}/`);

export const cancelContentItem = (
  id: number,
  body: { reason: string; release_candidate: boolean },
) => api.post<ContentItemDetail>(`/content-items/${id}/cancel/`, body);

export type EventType =
  | 'status_changed'
  | 'job_started'
  | 'job_failed'
  | 'edited'
  | 'qc_result'
  | 'review_decision'
  | 'publish_attempt'
  | 'note';

export type ContentEvent = {
  id: number;
  type: EventType;
  from_status: ItemStatus | null;
  to_status: ItemStatus | null;
  actor: UserRef | null;
  message: string;
  data: Record<string, any>;
  created_at: string;
};

export const listContentEvents = (
  id: number,
  params: { type?: EventType[]; page?: number; page_size?: number } = {},
) => api.get<Page<ContentEvent>>(`/content-items/${id}/events/`, params);

// E04-S02: format, media kind, production mode, role, slot.

export type ItemSettingsChange = {
  format?: Format;
  media_kind?: MediaKind;
  production_mode?: ProductionMode;
  role?: Role | null;
  slot?: number | null;
  confirm?: boolean;
};

export type ItemSettingsEffects = {
  status_from: ItemStatus;
  status_to: ItemStatus;
  superseded: { briefs: number[]; scripts: number[] };
  released_slot: { id: number; status: SlotStatus } | null;
  reserved_slot: { id: number } | null;
};

export const updateContentItem = (id: number, body: ItemSettingsChange) =>
  api.patch<ContentItemDetail & { effects?: ItemSettingsEffects }>(
    `/content-items/${id}/`,
    body,
  );

// Plan reads used by the workspace (owned by E01; minimal shapes here).

export type PlanSlot = {
  id: number;
  plan: number;
  scheduled_at: string;
  local_date: string;
  local_time: string;
  weekday: number;
  format: Format;
  role: Role | null;
  status: SlotStatus;
  note: string;
  content_item: { id: number; title: string; status: ItemStatus } | null;
};

export const listPlanSlots = (
  planId: number,
  params: { status?: SlotStatus[]; format?: Format[] } = {},
) =>
  api.get<Page<PlanSlot>>(`/plans/${planId}/slots/`, {
    ...params,
    page_size: 100,
  });

export type PlanDetailForContent = PlanRef & { success_metrics?: Metric[] };

export const getPlanForContent = (planId: number) =>
  api.get<PlanDetailForContent>(`/plans/${planId}/`);
