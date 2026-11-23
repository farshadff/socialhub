import { api, type Page } from './http';
import type { JobStarted } from './jobs';
import type { Format } from './formats';
import type { EvaluationMetric, EvaluationVerdict, GoalResult } from './evaluations';
import type { FindingState, PlanStatus } from './plans';

export type ReportStatus = 'draft' | 'accepted';
export type ReportMetric = EvaluationMetric | 'follower_growth';
export type ReportPlan = {
  id: number;
  title: string;
  week_start: string;
  week_end: string;
  status: PlanStatus;
};
export type ReportFinding = {
  id: string;
  type: 'worked' | 'didnt_work' | 'insight';
  title: string;
  detail: string;
  evidence_publications: number[];
  recommendation: string;
  plan_field: 'objective' | 'audience' | 'goals' | 'slots' | 'notes' | 'none';
  suggested_change: {
    note: string;
    metric?: EvaluationMetric;
    scope?: 'week_total' | 'per_post';
    format?: Format | null;
    target_value?: number;
  };
  accepted: boolean | null;
  plan_state?: FindingState;
};
export type ReportMetricTotal = {
  actual: number | null;
  goal: number | null;
  attainment: string | null;
  is_success_metric: boolean;
  posts_measured: number;
};
export type ReportPostRow = {
  publication: number;
  content_item?: number;
  title: string;
  format: Format;
  role?: string | null;
  published_at: string;
  primary_metric: EvaluationMetric;
  value: number | null;
  goal_target: number | null;
  goal_result: GoalResult;
  baseline_value: string | null;
  baseline_ratio: string | null;
  verdict: EvaluationVerdict;
  checkpoint: string;
  snapshot_checkpoint: string | null;
  provisional: boolean;
  values: Partial<Record<EvaluationMetric, number | null>>;
};
export type ReportTotals = {
  metrics: Record<EvaluationMetric, ReportMetricTotal>;
  format_goals: { metric: EvaluationMetric; format: Format; actual: number; goal: number; attainment: string }[];
  follower_change: { start: number | null; end: number | null; change: number | null; goal: number | null; attainment: string | null; complete: boolean };
  posts: {
    planned: number;
    skipped: number;
    published: number;
    unfinished: number;
    provisional: number;
    by_format: Partial<Record<Format, number>>;
    by_verdict: Partial<Record<EvaluationVerdict, number>>;
    goals_met: number;
    goals_missed: number;
  };
  best: Partial<Record<EvaluationMetric, { publication: number; value: number }>>;
  worst: Partial<Record<EvaluationMetric, { publication: number; value: number }>>;
  post_rows: ReportPostRow[];
  computed_at: string;
  provisional_until: string | null;
};
export type AppliedPlan = {
  id: number;
  title: string;
  week_start: string;
  status: PlanStatus;
  finding_states: Record<FindingState, number>;
};
export type ApplyEligiblePlan = Omit<ReportPlan, 'week_end'> & { week_end?: string; pending_findings?: number };
export type ReportListRow = {
  id: number;
  account: number;
  plan: ReportPlan;
  status: ReportStatus;
  provisional: boolean;
  posts: { planned: number; published: number };
  success_metrics: { metric: ReportMetric; actual: number | null; goal: number | null; attainment: string | null }[];
  follower_change: number | null;
  findings_count: { total: number; accepted: number; dismissed: number; undecided: number };
  applied_plan: AppliedPlan | null;
  generated_at: string;
  accepted_at: string | null;
};
export type WeeklyReport = ReportListRow & {
  summary: string;
  totals: ReportTotals;
  findings: ReportFinding[];
  ai_run: number | null;
  accepted_by: { id: number; name: string } | null;
};

export type ReportListParams = {
  account: number;
  status?: ReportStatus;
  plan?: number;
  ordering?: '-week_start' | 'week_start' | '-generated_at';
  page?: number;
  page_size?: number;
};

export const listWeeklyReports = (params: ReportListParams) =>
  api.get<Page<ReportListRow>>('/weekly-reports/', params);
export const getWeeklyReport = (id: number) =>
  api.get<WeeklyReport>(`/weekly-reports/${id}/`);
export const generateWeeklyReport = (body: { plan: number; mode?: 'full' | 'totals_only' }) =>
  api.post<JobStarted>('/weekly-reports/generate/', body);
export const updateWeeklyReport = (
  id: number,
  body: { summary?: string; findings?: (Omit<ReportFinding, 'id'> & { id?: string })[] },
) => api.patch<WeeklyReport>(`/weekly-reports/${id}/`, body);
export const acceptWeeklyReport = (id: number, body?: { decide_remaining: 'accept' | 'dismiss' }) =>
  api.post<WeeklyReport>(`/weekly-reports/${id}/accept/`, body ?? {});

export type ApplyDryRun = {
  dry_run: true;
  accepted_findings: number;
  target: {
    plan: ApplyEligiblePlan | null;
    will_create: boolean;
    week_start: string;
    week_end: string;
    duplicate_from: { id: number; title: string; status: 'active' | 'draft' } | null;
  };
  eligible_plans: ApplyEligiblePlan[];
  already_applied_plan: number | null;
};
export type ApplyResult = {
  report: { id: number; status: ReportStatus; applied_plan: number };
  plan: ReportPlan & { created: boolean; duplicated_from: number | null };
  carried_findings: { id: string; report_id: number; state: FindingState }[];
  added: number;
  changed: boolean;
};
export const previewReportApplication = (id: number, plan?: number) =>
  api.post<ApplyDryRun>(`/weekly-reports/${id}/apply-to-plan/`, { dry_run: true, ...(plan ? { plan } : {}) });
export const applyReportToPlan = (id: number, body: { plan?: number }) =>
  api.post<ApplyResult>(`/weekly-reports/${id}/apply-to-plan/`, { ...body, dry_run: false });
