/** Quality checks and human review (E07). Shapes follow the E07 story contracts. */
import { api, type Page } from './http';
import type { Job, JobSummary } from './jobs';
import type { Format } from './formats';
import { withAccount } from '@/utils/accountRequest';

export type CheckName = 'format' | 'rights' | 'copy' | 'facts' | 'design';
export type CheckOutcome = 'pass' | 'revise' | 'escalate';
export type RunOutcome = CheckOutcome | null;
export type FindingSeverity = 'blocker' | 'major' | 'minor' | 'info';
export type ReviewReason =
  | 'qc_escalated'
  | 'max_revisions'
  | 'publish_failed'
  | 'no_slot'
  | 'manual';
export type ReviewDecision = 'approve' | 'request_changes' | 'reject';
export type ReworkKind = 'copy' | 'script' | 'manual';

export type Finding = {
  code: string;
  severity: FindingSeverity;
  message: string;
  location: Record<string, string | number>;
  suggestion: string;
  auto_fixable: boolean;
  override_allowed: boolean;
  fix: 'copy' | 'render' | 'script' | null;
};

export type CheckResult = {
  check: CheckName;
  outcome: CheckOutcome;
  score: number;
  checker: 'rule' | 'ai' | string;
  findings: Finding[];
  details?: Record<string, any>;
  ai_run?: number | null;
};

export type QCRun = {
  id: number;
  attempt: number;
  trigger: 'submission' | 'revision' | 'manual_recheck';
  status: 'running' | 'completed' | 'failed';
  outcome: RunOutcome;
  summary: string;
  started_by?: { id: number; name: string } | null;
  content_version: {
    id: number;
    version: number;
    origin?: string;
    change_note: string;
  };
  review_task?: { id: number; status: 'open' | 'resolved'; reason: ReviewReason } | null;
  finding_counts: Partial<Record<FindingSeverity, number>>;
  results: CheckResult[];
  item?: { id: number; title: string; format: Format; status: string };
  version?: {
    id: number;
    version: number;
    origin: string;
    caption: string;
    hashtags: string[];
    alt_text: string;
    final_asset: MediaVersionAsset | null;
    cover_asset: MediaVersionAsset | null;
    frames: { index: number; asset_id: number; url: string }[];
  };
  created_at: string;
  completed_at: string | null;
};

export type MediaVersionAsset = {
  id: number;
  url: string;
  kind: 'image' | 'video';
  width: number | null;
  height: number | null;
  duration_ms: number | null;
};

export type ReviewTaskRow = {
  id: number;
  account: number;
  reason: ReviewReason;
  status: 'open' | 'resolved';
  detail: string;
  decision: ReviewDecision | null;
  decision_note: string;
  instructions: string;
  rework: ReworkKind | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: { id: number; name: string } | null;
  item: {
    id: number;
    title: string;
    format: Format;
    status: string;
    role?: string | null;
    plan?: number | null;
    slot?: { id: number; scheduled_at: string; status: string } | null;
    revision_count?: number;
    thumbnail_url?: string | null;
    active_job?: JobSummary | null;
  };
  qc_run?: Pick<QCRun, 'id' | 'outcome' | 'summary' | 'finding_counts'> | null;
  publication?: {
    id: number;
    status: string;
    scheduled_at: string | null;
    attempt_count: number;
    blocked_reason: string | null;
    last_error_code?: string | null;
    last_error_message?: string | null;
  } | null;
};

export type ReviewDecisionState = {
  allowed: boolean;
  reason?: string;
  requires_note?: boolean;
  requires_time?: boolean;
  blocking_findings?: { check?: CheckName; code: string; override_allowed?: boolean; message?: string }[];
  rework_options?: ReworkKind[];
};

export type ReviewTaskDetail = ReviewTaskRow & {
  overridden_findings: string[];
  item: ReviewTaskRow['item'] & {
    media_kind: string;
    production_mode: string;
    auto_revision_count?: number;
  };
  version: {
    id: number;
    version: number;
    origin: string;
    status: string;
    caption: string;
    hashtags: string[];
    alt_text: string;
    final_asset: MediaVersionAsset | null;
    cover_asset: MediaVersionAsset | null;
    frames: { index: number; asset_id: number; url: string; start_ms?: number }[];
    change_note: string;
  };
  previous_version: { id: number; version: number; status: string } | null;
  diff: {
    caption?: { changed: boolean; before?: string; after?: string };
    hashtags?: { added: string[]; removed: string[] };
    alt_text?: { changed: boolean };
    final_asset?: { changed: boolean };
    cover_asset?: { changed: boolean };
    frames_changed?: number[];
    script_version?: { before: number | null; after: number | null };
    change_note?: string;
  } | null;
  qc_run: QCRun | null;
  publication?: ReviewTaskRow['publication'];
  decisions: Record<ReviewDecision, ReviewDecisionState>;
  can_recheck: boolean;
};

export type ResolveReviewBody =
  | { decision: 'approve'; decision_note?: string; scheduled_at?: string; slot?: number }
  | { decision: 'request_changes'; rework: ReworkKind; instructions: string }
  | { decision: 'reject'; decision_note: string; release_candidate?: boolean };

export const listItemChecks = (itemId: number | string, signal?: AbortSignal) =>
  api.get<Page<QCRun>>(`/content-items/${itemId}/checks/`, { page_size: 20 }, signal);

export const getCheckRun = (runId: number | string) =>
  api.get<QCRun>(`/checks/runs/${runId}/`);

export const startCheckRun = (itemId: number | string) =>
  api.post<{ job: Job }>(`/content-items/${itemId}/checks/run/`);

export const retryRevision = (itemId: number | string) =>
  api.post<{ job: Job }>(`/content-items/${itemId}/revision/retry/`);

export const listReviewTasks = (params: {
  account: number;
  status?: 'open' | 'resolved';
  reason?: ReviewReason[];
  page?: number;
  page_size?: number;
  ordering?: 'created_at' | '-created_at';
}) => api.get<Page<ReviewTaskRow>>('/review-tasks/', withAccount(params));

export const getReviewTask = (taskId: number | string) =>
  api.get<ReviewTaskDetail>(`/review-tasks/${taskId}/`);

export const resolveReviewTask = (taskId: number | string, body: ResolveReviewBody) =>
  api.post<{
    review_task: ReviewTaskRow;
    item: { id: number; status: string; hold_reason?: string; active_job?: string | null };
    publication: { id: number; status: string; scheduled_at?: string | null } | null;
    job: Job | null;
    next_open_task_id: number | null;
  }>(`/review-tasks/${taskId}/resolve/`, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
