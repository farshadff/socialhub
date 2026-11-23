import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { Account } from '@/services/socialhub/accounts';
import type { FieldError } from '@/services/socialhub/http';
import type {
  CarriedFinding,
  FindingState,
  Format,
  Goal,
  GoalScope,
  Metric,
  Plan,
  PlanUpdate,
  ReadinessProblem,
  Role,
  Segment,
  SlotStatus,
} from '@/services/socialhub/plans';
import { fieldErrorText } from '@/utils/errorText';

dayjs.extend(utc);
dayjs.extend(timezone);

export const MAX_WEEKS_AHEAD = 8;

export const METRICS: { value: Metric; label: string; help: string }[] = [
  { value: 'reach', label: 'Reach', help: 'Accounts that saw the post.' },
  { value: 'views', label: 'Views', help: 'Times the post was played or seen.' },
  { value: 'likes', label: 'Likes', help: 'People who liked the post.' },
  { value: 'comments', label: 'Comments', help: 'Comments left on the post.' },
  { value: 'saves', label: 'Saves', help: 'People who saved the post for later.' },
  { value: 'shares', label: 'Shares', help: 'Times the post was sent or shared.' },
  { value: 'replies', label: 'Replies', help: 'Replies to a story.' },
  {
    value: 'follower_growth',
    label: 'Follower growth',
    help: 'Net new followers over the week.',
  },
];

export const metricLabel = (metric: string) =>
  METRICS.find((item) => item.value === metric)?.label ?? metric;

export const FORMATS: { value: Format; label: string }[] = [
  { value: 'reel', label: 'Reel' },
  { value: 'story', label: 'Story' },
  { value: 'feed_post', label: 'Feed post' },
];

export const formatLabel = (format: string | null) =>
  format === null
    ? 'All formats'
    : (FORMATS.find((item) => item.value === format)?.label ?? format);

export const SCOPES: { value: GoalScope; label: string }[] = [
  { value: 'week_total', label: 'Week total' },
  { value: 'per_post', label: 'Per post' },
];

export const ROLES: { value: Role; label: string; help: string }[] = [
  { value: 'attract', label: 'Attract', help: 'Reach new people.' },
  { value: 'educate', label: 'Educate', help: 'Teach something worth saving.' },
  { value: 'build_trust', label: 'Build trust', help: 'Proof, behind the scenes.' },
  { value: 'convert', label: 'Convert', help: 'Drive an action.' },
  { value: 'engage', label: 'Engage', help: 'Start interaction.' },
];

export const roleLabel = (role: string | null) =>
  ROLES.find((item) => item.value === role)?.label ?? role ?? '';

export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** dayjs counts Sunday as 0; the API counts Monday as 0. */
export const apiWeekday = (date: Dayjs) => (date.day() + 6) % 7;

/** "28 Nov – 4 Dec 2026" */
export function weekRange(weekStart: string, weekEnd?: string) {
  const start = dayjs(weekStart);
  const end = weekEnd ? dayjs(weekEnd) : start.add(6, 'day');
  return `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`;
}

export function localToday(tz: string, now: Dayjs = dayjs()) {
  return now.tz(tz).format('YYYY-MM-DD');
}

/** Valid week starts for a new plan: the current week and the next eight (E01-S01 rule 3). */
export function weekStartOptions(
  account: Pick<Account, 'timezone' | 'week_start_day'>,
  now: Dayjs = dayjs(),
): string[] {
  const today = dayjs(localToday(account.timezone, now));
  const back = (apiWeekday(today) - account.week_start_day + 7) % 7;
  const first = today.subtract(back, 'day');
  return Array.from({ length: MAX_WEEKS_AHEAD + 1 }, (_, index) =>
    first.add(index * 7, 'day').format('YYYY-MM-DD'),
  );
}

export function weekEnded(weekEnd: string, tz: string, now: Dayjs = dayjs()) {
  return localToday(tz, now) > weekEnd;
}

// --- readiness ------------------------------------------------------------------------------

export type ReadinessLine = {
  code: ReadinessProblem['code'];
  label: string;
  /** Where the line links when it fails. */
  target: 'objective' | 'audience_summary' | 'slots' | 'goals' | null;
};

export const READINESS_LINES: ReadinessLine[] = [
  { code: 'objective_missing', label: 'Objective written', target: 'objective' },
  { code: 'audience_missing', label: 'Audience written', target: 'audience_summary' },
  { code: 'no_slots', label: 'At least one slot', target: 'slots' },
  { code: 'goal_missing', label: 'A goal for every success metric', target: 'goals' },
  { code: 'week_ended', label: 'Week not ended', target: null },
];

export function problemText(problem: ReadinessProblem): string {
  switch (problem.code) {
    case 'objective_missing':
      return 'Write the objective';
    case 'audience_missing':
      return 'Describe the audience';
    case 'no_slots':
      return 'Add at least one slot';
    case 'goal_missing':
      return `Set a goal for ${(problem.details?.metrics ?? []).map(metricLabel).join(', ').toLowerCase()}`;
    case 'week_ended':
      return 'The week has ended';
    default:
      return problem.code;
  }
}

// --- goals ----------------------------------------------------------------------------------

/** Goal row in the form: `format` uses 'all' for null, which a Select can show. */
export type GoalRow = Omit<Goal, 'format'> & { format: Format | 'all' };

export const toGoalRow = (goal: Goal): GoalRow => ({
  ...goal,
  format: goal.format ?? 'all',
});

export const fromGoalRow = (row: GoalRow): Goal => {
  const goal: Goal = {
    metric: row.metric,
    scope: row.scope,
    format: row.format === 'all' ? null : row.format,
    target_value: Number(row.target_value),
  };
  if (row.id) goal.id = row.id;
  return goal;
};

/** Formats a goal may use for a metric (E01-S01 rule 8). */
export function allowedGoalFormats(metric?: Metric): (Format | 'all')[] {
  if (metric === 'follower_growth') return ['all'];
  if (metric === 'replies') return ['all', 'story'];
  return ['all', 'reel', 'story', 'feed_post'];
}

export function allowedScopes(metric?: Metric): GoalScope[] {
  return metric === 'follower_growth' ? ['week_total'] : ['week_total', 'per_post'];
}

export function metricsWithoutGoal(
  successMetrics: Metric[] = [],
  goals: Partial<GoalRow>[] = [],
): Metric[] {
  const covered = new Set(goals.map((goal) => goal?.metric));
  return successMetrics.filter((metric) => !covered.has(metric));
}

// --- plan form ----------------------------------------------------------------------------

export type PlanFormValues = {
  objective: string;
  audience_summary: string;
  audience_segments: Segment[];
  success_metrics: Metric[];
  goals: GoalRow[];
  notes: string;
};

const FIELDS: (keyof PlanFormValues)[] = [
  'objective',
  'audience_summary',
  'audience_segments',
  'success_metrics',
  'goals',
  'notes',
];

export const formValuesFrom = (plan: Plan): PlanFormValues => ({
  objective: plan.objective,
  audience_summary: plan.audience_summary,
  audience_segments: plan.audience_segments.map((segment) => ({
    name: segment.name,
    description: segment.description ?? '',
  })),
  success_metrics: plan.success_metrics,
  goals: plan.goals.map(toGoalRow),
  notes: plan.notes,
});

export const findingStatesFrom = (plan: Plan) =>
  Object.fromEntries(plan.carried_findings.map((f) => [f.id, f.state])) as Record<
    string,
    FindingState
  >;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that changed, in the API's shape. */
export function buildPatch(
  initial: PlanFormValues,
  values: PlanFormValues,
  initialStates: Record<string, FindingState>,
  states: Record<string, FindingState>,
): PlanUpdate {
  const patch: PlanUpdate = {};
  for (const field of FIELDS) {
    if (same(initial[field], values[field])) continue;
    if (field === 'goals') {
      patch.goals = (values.goals ?? []).map(fromGoalRow);
    } else if (field === 'audience_segments') {
      patch.audience_segments = (values.audience_segments ?? []).map((segment) => ({
        name: (segment.name ?? '').trim(),
        description: (segment.description ?? '').trim(),
      }));
    } else {
      (patch as Record<string, unknown>)[field] = values[field];
    }
  }
  const changedStates = Object.entries(states).filter(
    ([id, state]) => initialStates[id] !== state,
  );
  if (changedStates.length > 0) {
    patch.carried_findings_state = changedStates.map(([id, state]) => ({ id, state }));
  }
  return patch;
}

// --- carried findings -----------------------------------------------------------------------

export const FINDING_TYPE: Record<
  CarriedFinding['type'],
  { label: string; color: string }
> = {
  worked: { label: 'Worked', color: 'success' },
  did_not_work: { label: 'Did not work', color: 'error' },
  insight: { label: 'Insight', color: 'processing' },
};

export type FindingEffect =
  | { kind: 'append'; field: 'objective' | 'audience_summary' | 'notes'; text: string }
  | { kind: 'goal'; goal: Partial<GoalRow> }
  | { kind: 'none' };

/** What "Apply" does to the form for a finding (E01-S01, panel behaviour). */
export function findingEffect(finding: CarriedFinding): FindingEffect {
  switch (finding.plan_field) {
    case 'objective':
      return { kind: 'append', field: 'objective', text: finding.recommendation };
    case 'audience':
      return { kind: 'append', field: 'audience_summary', text: finding.recommendation };
    case 'notes':
      return { kind: 'append', field: 'notes', text: finding.recommendation };
    case 'goals': {
      const change = finding.suggested_change ?? {};
      const complete = ['metric', 'scope', 'format', 'target_value'].every(
        (key) => key in change,
      );
      return {
        kind: 'goal',
        goal: complete
          ? {
              metric: change.metric,
              scope: change.scope,
              format: change.format ?? 'all',
              target_value: change.target_value,
            }
          : {},
      };
    }
    default:
      return { kind: 'none' };
  }
}

export const appendText = (current: string | undefined, addition: string) =>
  current?.trim() ? `${current.trimEnd()}\n${addition}` : addition;

// --- slots ----------------------------------------------------------------------------------

/** What an operator may change on a slot, by status (E01-S02 rule 14). */
export const SLOT_PERMISSIONS: Record<
  SlotStatus,
  { time: boolean; format: boolean; role: boolean; skip: boolean; remove: boolean }
> = {
  open: { time: true, format: true, role: true, skip: true, remove: true },
  skipped: { time: true, format: true, role: true, skip: true, remove: true },
  reserved: { time: true, format: false, role: true, skip: false, remove: false },
  scheduled: { time: false, format: false, role: false, skip: false, remove: false },
  published: { time: false, format: false, role: false, skip: false, remove: false },
};

export const FILLED: SlotStatus[] = ['reserved', 'scheduled', 'published'];

export function slotSummaryLine(
  summary: { total: number; by_format: Partial<Record<Format, number>> },
  filled: number,
) {
  const count = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  return [
    count(summary.total, 'slot', 'slots'),
    count(summary.by_format.reel ?? 0, 'reel', 'reels'),
    count(summary.by_format.story ?? 0, 'story', 'stories'),
    count(summary.by_format.feed_post ?? 0, 'feed post', 'feed posts'),
    `${filled} filled`,
  ].join(' · ');
}

// --- field errors ---------------------------------------------------------------------------

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'eleventh'];

/** Field error text, with the account's own limit spelled out for the daily-limit code. */
export function planFieldText(
  field: FieldError,
  account?: Pick<Account, 'posting_rules'> | null,
  format?: Format,
): string {
  if (field.code === 'exceeds_daily_limit') {
    const rules = account?.posting_rules;
    if (rules && format) {
      const story = format === 'story';
      const limit = story ? rules.max_stories_per_day : rules.max_feed_per_day;
      const what = story ? 'story' : 'feed post or reel';
      return `This would be the ${ORDINALS[limit] ?? `${limit + 1}th`} ${what} that day. The account allows ${limit}.`;
    }
    return "This goes over the account's daily limit for this format.";
  }
  if (field.code === 'gap_too_small' && account?.posting_rules) {
    return `Reels and feed posts need to be at least ${account.posting_rules.min_gap_minutes} minutes apart.`;
  }
  return fieldErrorText(field);
}

export function postingRulesText(account?: Pick<Account, 'posting_rules'> | null) {
  const rules = account?.posting_rules;
  if (!rules) return '';
  return `Up to ${rules.max_feed_per_day} reels or feed posts and ${rules.max_stories_per_day} stories per day, at least ${rules.min_gap_minutes} minutes apart.`;
}
