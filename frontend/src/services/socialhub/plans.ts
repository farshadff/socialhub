/**
 * Weekly plan API (epic E01): plans, goals, slots, slot template and plan lifecycle.
 * Shapes follow docs/epics/E01-weekly-plan/S01–S03.
 */
import { api, type Page } from './http';

export type PlanStatus = 'draft' | 'active' | 'closed';
export type Metric =
  | 'reach'
  | 'views'
  | 'likes'
  | 'comments'
  | 'saves'
  | 'shares'
  | 'replies'
  | 'follower_growth';
export type Format = 'reel' | 'story' | 'feed_post';
export type Role = 'attract' | 'educate' | 'build_trust' | 'convert' | 'engage';
export type GoalScope = 'week_total' | 'per_post';
export type SlotStatus =
  | 'open'
  | 'reserved'
  | 'scheduled'
  | 'published'
  | 'skipped';
export type FindingState = 'pending' | 'applied' | 'ignored';

/** List-row fields every plan has (research's plan picker uses only these). */
export type PlanSummary = {
  id: number;
  account: number;
  week_start: string;
  week_end: string;
  status: PlanStatus;
  title: string;
};

export type SlotSummary = {
  total: number;
  filled: number;
  by_format: Partial<Record<Format, number>>;
  by_status: Partial<Record<SlotStatus, number>>;
};

export type ReadinessProblem = {
  code:
    | 'objective_missing'
    | 'audience_missing'
    | 'no_slots'
    | 'goal_missing'
    | 'week_ended';
  details?: { metrics?: Metric[] };
};

export type Readiness = { can_activate: boolean; problems: ReadinessProblem[] };

export type PlanRow = PlanSummary & {
  success_metrics: Metric[];
  slot_summary: SlotSummary;
  readiness: Readiness;
  activated_at: string | null;
  closed_at: string | null;
  updated_at: string;
};

export type Goal = {
  id?: number;
  metric: Metric;
  scope: GoalScope;
  format: Format | null;
  target_value: number;
};

export type Segment = { name: string; description: string };

export type CarriedFinding = {
  id: string;
  report_id: number;
  type: 'worked' | 'did_not_work' | 'insight';
  title: string;
  detail: string;
  recommendation: string;
  plan_field: 'objective' | 'audience' | 'goals' | 'slots' | 'notes' | 'none';
  suggested_change: Record<string, any> | null;
  state: FindingState;
};

export type Plan = PlanRow & {
  objective: string;
  audience_summary: string;
  audience_segments: Segment[];
  goals: Goal[];
  notes: string;
  carried_findings: CarriedFinding[];
  source_report: number | null;
  created_by: { id: number; name: string } | null;
  created_at: string;
};

export type PlanUpdate = Partial<
  Pick<
    Plan,
    | 'title'
    | 'objective'
    | 'audience_summary'
    | 'audience_segments'
    | 'success_metrics'
    | 'goals'
    | 'notes'
  >
> & { carried_findings_state?: { id: string; state: FindingState }[] };

export type Slot = {
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
  content_item: { id: number; title: string; status: string } | null;
};

export type SlotWrite = {
  local_date?: string;
  local_time?: string;
  scheduled_at?: string;
  format?: Format;
  role?: Role | null;
  note?: string;
  status?: 'open' | 'skipped';
};

export type TemplateRow = {
  id?: number;
  weekday: number;
  local_time: string;
  format: Format;
  default_role: Role | null;
  active: boolean;
};

export type SlotTemplate = {
  account: number;
  timezone: string;
  rows: TemplateRow[];
};

// --- plans (E01-S01) ----------------------------------------------------------------------

export const listPlans = (params: {
  account: number;
  status?: PlanStatus[];
  ordering?: string;
}) =>
  api.get<Page<PlanSummary>>('/plans/', {
    account: params.account,
    status: params.status,
    ordering: params.ordering ?? 'week_start',
    page_size: 100,
  });

export const listPlanRows = (params: {
  account: number;
  status?: PlanStatus[];
  week_start_after?: string;
  week_start_before?: string;
  ordering?: 'week_start' | '-week_start';
  page?: number;
  page_size?: number;
}) => api.get<Page<PlanRow>>('/plans/', params);

export const getPlan = (id: number | string) => api.get<Plan>(`/plans/${id}/`);

export const getCurrentPlan = (account: number) =>
  api.get<Plan>('/plans/current/', { account });

export const createPlan = (body: {
  account: number;
  week_start: string;
  title?: string;
  generate_slots?: boolean;
}) => api.post<Plan>('/plans/', body);

export const updatePlan = (id: number, body: PlanUpdate) =>
  api.patch<Plan>(`/plans/${id}/`, body);

export const deletePlan = (id: number) => api.delete(`/plans/${id}/`);

// --- lifecycle (E01-S03) ------------------------------------------------------------------

export const activatePlan = (id: number) =>
  api.post<Plan>(`/plans/${id}/activate/`);

export const closePlan = (id: number, force = false) =>
  api.post<{ plan: Plan; slots_skipped: number; unfinished_items: number }>(
    `/plans/${id}/close/`,
    { force },
  );

export const duplicatePlan = (
  id: number,
  body: { week_start?: string; copy_slots?: boolean },
) => api.post<Plan>(`/plans/${id}/duplicate/`, body);

// --- slots and template (E01-S02) ---------------------------------------------------------

export const listSlots = (planId: number) =>
  api.get<Page<Slot>>(`/plans/${planId}/slots/`, { page_size: 100 });

export const createSlot = (planId: number, body: SlotWrite) =>
  api.post<Slot>(`/plans/${planId}/slots/`, body);

export const updateSlot = (id: number, body: SlotWrite) =>
  api.patch<Slot>(`/slots/${id}/`, body);

export const deleteSlot = (id: number) => api.delete(`/slots/${id}/`);

export const generateSlots = (planId: number, replace = false) =>
  api.post<{ created: number; skipped: number; deleted: number; slots: Slot[] }>(
    `/plans/${planId}/slots/generate/`,
    { replace },
  );

export const getSlotTemplate = (accountId: number) =>
  api.get<SlotTemplate>(`/accounts/${accountId}/slot-template/`);

export const saveSlotTemplate = (
  accountId: number,
  rows: Omit<TemplateRow, 'id'>[],
) => api.put<SlotTemplate>(`/accounts/${accountId}/slot-template/`, { rows });
