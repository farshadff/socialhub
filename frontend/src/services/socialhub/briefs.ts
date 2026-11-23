/** Briefs (E04-S03). */
import { api, type Page } from './http';
import type { BriefStatus, DocOrigin, ItemStatus, UserRef } from './content';
import type { Metric, Role } from './formats';
import type { Job } from './jobs';

export type BriefReference = { title: string; url: string };

/** The editable fields of a brief, as sent in `PUT /brief/`. */
export type BriefFields = {
  objective: string;
  key_message: string;
  hook_direction: string;
  audience_note: string;
  cta: string;
  must_include: string[];
  must_avoid: string[];
  references: BriefReference[];
  format_notes: string;
  success_metric: Metric;
};

export type Brief = BriefFields & {
  id: number;
  version: number;
  role: Role;
  status: BriefStatus;
  origin: DocOrigin;
  feedback: string;
  ai_run: number | null;
  created_by: UserRef | null;
  created_at: string;
};

export type ValidationIssue = {
  code: string;
  path: string;
  message: string;
  limit?: number;
  actual?: number;
};

export type Validation = { valid: boolean; issues: ValidationIssue[] };

export type BriefWarningCode = 'metric_not_in_plan' | 'no_references';

export type BriefResource = {
  content_item: number;
  brief: Brief | null;
  latest_version: number;
  approved_version: number | null;
  validation: Validation;
  warnings: (BriefWarningCode | { code: BriefWarningCode; message?: string })[];
  actions: { can_generate: boolean; can_edit: boolean; can_approve: boolean };
  /** Only on the approve response. */
  item_status?: ItemStatus;
};

const base = (itemId: number) => `/content-items/${itemId}/brief`;

export const getBrief = (itemId: number, version?: number) =>
  api.get<BriefResource>(`${base(itemId)}/`, { version });

export const listBriefVersions = (itemId: number) =>
  api.get<Page<Brief>>(`${base(itemId)}/versions/`, { page_size: 50 });

export const generateBrief = (
  itemId: number,
  body: { feedback?: string; base_version?: number } = {},
) => api.post<{ job: Job }>(`${base(itemId)}/generate/`, body);

export const saveBrief = (
  itemId: number,
  body: BriefFields & { base_version: number; note?: string },
) => api.put<BriefResource>(`${base(itemId)}/`, body);

export const approveBrief = (itemId: number, version: number) =>
  api.post<BriefResource>(`${base(itemId)}/approve/`, { version });

export type BatchSkipReason =
  | 'not_in_plan'
  | 'wrong_status'
  | 'has_approved_brief'
  | 'has_draft'
  | 'job_running';

export type BriefBatchResult = {
  total: number;
  done: number;
  created?: number;
  failed?: number;
  skipped: { content_item: number; reason: BatchSkipReason }[];
  items: {
    content_item: number;
    job: string;
    status: string;
    brief_version: number | null;
    auto_approved: boolean;
    error_code: string | null;
  }[];
};

export const generatePlanBriefs = (
  planId: number,
  body: { content_items?: number[]; regenerate_drafts?: boolean } = {},
) => api.post<{ job: Job }>(`/plans/${planId}/briefs/generate/`, body);

/** Field limits from E04-S03 rule 2, used for counters in the editor. */
export const BRIEF_LIMITS = {
  objective: { min: 20, max: 400 },
  key_message: { min: 10, max: 200 },
  hook_direction: { min: 10, max: 300 },
  audience_note: { min: 0, max: 300 },
  cta: { min: 0, max: 120 },
  format_notes: { min: 10, max: 600 },
  list_items: 6,
  list_item_chars: 120,
  references: 8,
  reference_title: 200,
  reference_url: 2000,
  feedback: 1000,
} as const;
