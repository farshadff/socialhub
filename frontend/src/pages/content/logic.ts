/**
 * Pure helpers for the content pipeline and the item workspace (E03-S04). No React, no requests.
 */
import type {
  ContentItemSummary,
  EventType,
  ItemListParams,
  ItemStatus,
} from '@/services/socialhub/content';
import type { Format, Role } from '@/services/socialhub/formats';

// --- Board -------------------------------------------------------------------------------------

export type BoardColumn = {
  key: string;
  title: string;
  statuses: ItemStatus[];
};

/** The board's columns in workflow order (E03-S04 Panel). */
export const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'selected', title: 'Selected', statuses: ['selected'] },
  { key: 'briefed', title: 'Briefed', statuses: ['briefed'] },
  { key: 'scripted', title: 'Scripted', statuses: ['scripted'] },
  {
    key: 'production',
    title: 'In production',
    statuses: ['in_production', 'needs_revision'],
  },
  { key: 'check', title: 'In check', statuses: ['in_check', 'in_review'] },
  {
    key: 'ready',
    title: 'Ready and scheduled',
    statuses: ['approved', 'scheduled', 'publishing', 'failed'],
  },
  { key: 'published', title: 'Published', statuses: ['published'] },
];

export const CANCELLED_COLUMN: BoardColumn = {
  key: 'cancelled',
  title: 'Cancelled',
  statuses: ['cancelled'],
};

export const BOARD_LIMIT = 100;

const slotTime = (item: ContentItemSummary) => item.slot?.scheduled_at ?? null;

/** Cards sorted by slot time; items without a slot go last. */
export function bySlotTime(
  a: ContentItemSummary,
  b: ContentItemSummary,
): number {
  const at = slotTime(a);
  const bt = slotTime(b);
  if (at && bt) return at.localeCompare(bt) || a.id - b.id;
  if (at) return -1;
  if (bt) return 1;
  return a.id - b.id;
}

/**
 * Groups items into board columns. Cancelled items are hidden unless the status filter includes
 * `cancelled`, in which case an eighth column appears.
 */
export function groupForBoard(
  items: ContentItemSummary[],
  statusFilter: ItemStatus[],
): { column: BoardColumn; items: ContentItemSummary[] }[] {
  const columns = statusFilter.includes('cancelled')
    ? [...BOARD_COLUMNS, CANCELLED_COLUMN]
    : BOARD_COLUMNS;
  return columns.map((column) => ({
    column,
    items: items
      .filter((item) => column.statuses.includes(item.status))
      .sort(bySlotTime),
  }));
}

// --- Filters in the query string --------------------------------------------------------------

export type ContentView = 'list' | 'board';

export type ContentFilters = {
  /** A plan ID, `all`, or null while the default plan is not known yet. */
  plan: number | 'all' | null;
  status: ItemStatus[];
  format: Format[];
  role: Role | 'none' | null;
  needsAttention: boolean;
  search: string;
};

const ITEM_STATUS_SET = new Set<string>([
  'selected',
  'briefed',
  'scripted',
  'in_production',
  'in_check',
  'needs_revision',
  'in_review',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
]);
const FORMAT_SET = new Set<string>(['reel', 'story', 'feed_post']);
const ROLE_SET = new Set<string>([
  'attract',
  'educate',
  'build_trust',
  'convert',
  'engage',
  'none',
]);

const csv = (value: string | null) =>
  value ? value.split(',').filter(Boolean) : [];

/** Reads the filters from `?plan=&status=&format=&role=&attention=&q=`, ignoring bad values. */
export function parseFilters(params: URLSearchParams): ContentFilters {
  const plan = params.get('plan');
  const role = params.get('role');
  return {
    plan:
      plan === 'all' ? 'all' : plan && /^\d+$/.test(plan) ? Number(plan) : null,
    status: csv(params.get('status')).filter((s) =>
      ITEM_STATUS_SET.has(s),
    ) as ItemStatus[],
    format: csv(params.get('format')).filter((f) =>
      FORMAT_SET.has(f),
    ) as Format[],
    role: role && ROLE_SET.has(role) ? (role as Role | 'none') : null,
    needsAttention: params.get('attention') === '1',
    search: params.get('q') ?? '',
  };
}

/** Writes the filters back; empty values are removed so links stay short. */
export function filtersToParams(
  filters: ContentFilters,
  base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams(base);
  const set = (key: string, value: string | null) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  set('plan', filters.plan === null ? null : String(filters.plan));
  set('status', filters.status.join(','));
  set('format', filters.format.join(','));
  set('role', filters.role);
  set('attention', filters.needsAttention ? '1' : null);
  set('q', filters.search.trim() || null);
  return next;
}

/** The list request for the filters (E03-S04 API). */
export function filtersToRequest(
  account: number,
  filters: ContentFilters,
): ItemListParams {
  return {
    account,
    plan: typeof filters.plan === 'number' ? filters.plan : undefined,
    status: filters.status.length ? filters.status : undefined,
    format: filters.format.length ? filters.format : undefined,
    role: filters.role ? [filters.role] : undefined,
    needs_attention: filters.needsAttention ? true : undefined,
    search: filters.search.trim() || undefined,
  };
}

// --- Workspace ---------------------------------------------------------------------------------

export type WorkspaceTab =
  | 'brief'
  | 'script'
  | 'production'
  | 'checks'
  | 'publishing'
  | 'performance'
  | 'history';

export const WORKSPACE_TABS: WorkspaceTab[] = [
  'brief',
  'script',
  'production',
  'checks',
  'publishing',
  'performance',
  'history',
];

/** The tab shown when `?tab=` is absent (E03-S04 Panel). */
export function defaultTab(status: ItemStatus): WorkspaceTab {
  switch (status) {
    case 'selected':
      return 'brief';
    case 'briefed':
      return 'script';
    case 'scripted':
    case 'in_production':
    case 'needs_revision':
      return 'production';
    case 'in_check':
    case 'in_review':
      return 'checks';
    case 'approved':
    case 'scheduled':
    case 'publishing':
    case 'failed':
      return 'publishing';
    case 'published':
      return 'performance';
    default:
      return 'history';
  }
}

export const STEP_TITLES = [
  'Selected',
  'Brief',
  'Script',
  'Production',
  'Check',
  'Schedule',
  'Published',
] as const;

export type StepState = {
  /** Index into STEP_TITLES of the step in progress. */
  current: number;
  status: 'process' | 'wait' | 'error' | 'finish';
};

/** Step indicator mapping (E03-S04 Panel). Cancelled items show where they stopped as `wait`. */
export function stepFor(status: ItemStatus): StepState {
  switch (status) {
    case 'selected':
      return { current: 1, status: 'process' };
    case 'briefed':
      return { current: 2, status: 'process' };
    case 'scripted':
    case 'in_production':
      return { current: 3, status: 'process' };
    case 'needs_revision':
      return { current: 3, status: 'wait' };
    case 'in_check':
      return { current: 4, status: 'process' };
    case 'in_review':
      return { current: 4, status: 'wait' };
    case 'approved':
    case 'scheduled':
    case 'publishing':
      return { current: 5, status: 'process' };
    case 'failed':
      return { current: 5, status: 'error' };
    case 'published':
      return { current: 6, status: 'finish' };
    default:
      return { current: 0, status: 'wait' };
  }
}

/** Statuses the step indicator shows with the warning colour. */
export const WARNING_STATUSES: ItemStatus[] = ['needs_revision', 'in_review'];

export const TAB_PLACEHOLDER: Record<WorkspaceTab, string> = {
  brief: 'The brief appears here once it is written.',
  script: 'The script appears here once the brief is approved.',
  production: 'Production starts here once the script is approved.',
  checks: 'Quality check results appear here once a version is submitted.',
  publishing:
    'Scheduling and publishing appear here once the item is approved.',
  performance: 'Performance appears here once the post is published.',
  history: '',
};

// --- History -----------------------------------------------------------------------------------

export type HistoryFilter = 'all' | 'status' | 'jobs' | 'edits';

export const HISTORY_FILTER_TYPES: Record<
  HistoryFilter,
  EventType[] | undefined
> = {
  all: undefined,
  status: ['status_changed'],
  jobs: ['job_started', 'job_failed'],
  edits: ['edited'],
};

/** Items in these statuses can no longer be cancelled from the panel. */
export const NOT_CANCELLABLE: ItemStatus[] = [
  'published',
  'cancelled',
  'publishing',
];
