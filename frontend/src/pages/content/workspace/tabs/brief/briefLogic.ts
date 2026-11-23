/** Pure helpers for the Brief tab (E04-S03), kept apart for unit tests. */
import type {
  Brief,
  BriefFields,
  BriefResource,
  BriefWarningCode,
  ValidationIssue,
} from '@/services/socialhub/briefs';
import type { BriefStatus } from '@/services/socialhub/content';
import {
  type Format,
  METRIC_LABEL,
  type Metric,
  type RoleInfo,
} from '@/services/socialhub/formats';

export type BriefFormValues = BriefFields & { note: string };

export const FIELD_LABEL: Record<string, string> = {
  role: 'Role',
  objective: 'Objective',
  key_message: 'Key message',
  hook_direction: 'Hook direction',
  audience_note: 'Audience',
  cta: 'Call to action',
  must_include: 'Must include',
  must_avoid: 'Must avoid',
  references: 'References',
  format_notes: 'Format notes',
  success_metric: 'Success metric',
  feedback: 'Feedback',
  note: 'What changed?',
};

export function emptyFields(defaultMetric: Metric): BriefFormValues {
  return {
    objective: '',
    key_message: '',
    hook_direction: '',
    audience_note: '',
    cta: '',
    must_include: [],
    must_avoid: [],
    references: [],
    format_notes: '',
    success_metric: defaultMetric,
    note: '',
  };
}

export function fieldsOf(brief: Brief, note = ''): BriefFormValues {
  return {
    objective: brief.objective,
    key_message: brief.key_message,
    hook_direction: brief.hook_direction,
    audience_note: brief.audience_note,
    cta: brief.cta,
    must_include: [...brief.must_include],
    must_avoid: [...brief.must_avoid],
    references: brief.references.map((r) => ({ ...r })),
    format_notes: brief.format_notes,
    success_metric: brief.success_metric,
    note,
  };
}

/** Trims text and drops empty list rows before sending; the server validates the rest. */
export function toPayload(values: BriefFormValues): BriefFields & { note?: string } {
  const text = (v: string | undefined) => (v ?? '').trim();
  const list = (items: string[] | undefined) =>
    (items ?? []).map((i) => text(i)).filter((i) => i !== '');
  const note = text(values.note);
  return {
    objective: text(values.objective),
    key_message: text(values.key_message),
    hook_direction: text(values.hook_direction),
    audience_note: text(values.audience_note),
    cta: text(values.cta),
    must_include: list(values.must_include),
    must_avoid: list(values.must_avoid),
    references: (values.references ?? [])
      .map((r) => ({ title: text(r?.title), url: text(r?.url) }))
      .filter((r) => r.title !== '' || r.url !== ''),
    format_notes: text(values.format_notes),
    success_metric: values.success_metric,
    ...(note ? { note } : {}),
  };
}

/** True when the form differs from where editing started (the note alone does not count). */
export function isDirty(start: BriefFormValues, current: BriefFormValues): boolean {
  const { note: _a, ...a } = toPayload(start) as BriefFields & { note?: string };
  const { note: _b, ...b } = toPayload(current) as BriefFields & { note?: string };
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function defaultMetricFor(role: RoleInfo | undefined, format: Format): Metric | undefined {
  if (!role) return undefined;
  return format === 'story' ? role.default_metric_story : role.default_metric;
}

export function metricList(metrics: Metric[]): string {
  return metrics.map((m) => METRIC_LABEL[m] ?? m).join(', ');
}

/** English text for the non-blocking `warnings` of `GET /brief/`. */
export function warningText(
  warning: BriefResource['warnings'][number],
  brief: Brief | null,
  planMetrics: Metric[] | undefined,
): string {
  const code: BriefWarningCode = typeof warning === 'string' ? warning : warning.code;
  if (code === 'metric_not_in_plan') {
    const metric = brief ? (METRIC_LABEL[brief.success_metric] ?? brief.success_metric) : 'The metric';
    const week = planMetrics && planMetrics.length > 0 ? ` (${metricList(planMetrics)})` : '';
    return `Success metric ${metric} is not one of this week's success metrics${week}.`;
  }
  if (code === 'no_references') {
    return 'No references. Claims in the script cannot be checked against sources.';
  }
  return typeof warning === 'string' ? warning : (warning.message ?? warning.code);
}

/** The form field name of an issue path: `references.2.url` → ['references', 2, 'url']. */
export function issueFieldName(path: string): (string | number)[] {
  return path
    .split('.')
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function issueLabel(issue: ValidationIssue): string {
  const [head, index, sub] = issueFieldName(issue.path);
  const base = FIELD_LABEL[String(head)] ?? String(head);
  if (typeof index === 'number') {
    const item = head === 'references' ? `reference ${index + 1}` : `item ${index + 1}`;
    return `${base}, ${item}${sub ? ` ${sub === 'url' ? 'URL' : String(sub)}` : ''}`;
  }
  return base;
}

export const STATUS_WORD: Record<BriefStatus, string> = {
  draft: 'Waiting for approval',
  approved: 'Approved',
  superseded: 'Superseded',
};

export function originText(brief: Pick<Brief, 'origin' | 'created_by'>): string {
  if (brief.origin === 'ai') return 'AI';
  return `Edited by ${brief.created_by?.name ?? 'someone'}`;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
