import { api } from './http';
import type { ConnectionStatus } from './accounts';
import type { EvaluationMetric } from './evaluations';
import type { Format } from './formats';
import type { PlanStatus, SlotStatus } from './plans';

export type OverviewGoal = {
  metric: EvaluationMetric | 'follower_growth';
  scope: 'week_total';
  format: Format | null;
  target_value: number;
  actual: number | null;
  attainment: number | null;
  partial: boolean;
};
export type OverviewPlan = {
  id: number;
  title: string;
  status: PlanStatus;
  week_start: string;
  week_end: string;
  objective: string;
  slots: { total: number } & Partial<Record<SlotStatus, number>>;
  goals: OverviewGoal[];
};
export type AttentionItem = {
  id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  link: string;
  since: string | null;
  count: number;
  requires_admin: boolean;
};
export type NextPublication = {
  id: number;
  content_item: number;
  title: string;
  format: Format;
  status: 'scheduled' | 'publishing' | 'verifying';
  scheduled_at: string;
  blocked_reason: string | null;
};
export type Overview = {
  generated_at: string;
  account: {
    id: number;
    handle: string;
    timezone: string;
    publishing_enabled: boolean;
    connection_status: ConnectionStatus;
  };
  plan: OverviewPlan | null;
  items_by_status: Record<string, number>;
  items_waiting: { brief_approval: number; script_approval: number };
  attention_count: number;
  attention: AttentionItem[];
  next_publications: NextPublication[];
  sync: {
    metrics_last_snapshot_at: string | null;
    metrics_overdue: number;
    followers_last_snapshot_date: string | null;
    connection_status: ConnectionStatus;
    connection_last_verified_at: string | null;
    connection_token_expires_at: string | null;
    feeds_last_synced_at: string | null;
  };
  followers: { current: number | null; change_7d: number | null };
};

export const OVERVIEW_KEY = (accountId: number | null) => [accountId, 'overview'] as const;
export const getOverview = (account: number, fresh = false) =>
  api.get<Overview>('/overview/', { account, fresh: fresh ? 1 : undefined });
