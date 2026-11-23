/** Pure rules behind the "Format and role" modal (E04-S02), kept apart for unit tests. */
import type { ContentItemDetail, SlotRef } from '@/services/socialhub/content';
import type {
  Format,
  FormatsResponse,
  MediaKind,
  ProductionMode,
  Role,
} from '@/services/socialhub/formats';

export type FormatRoleValues = {
  format: Format;
  media_kind: MediaKind;
  production_mode: ProductionMode;
  role: Role | null;
  slot: number | null;
};

export type SlotOption = {
  id: number;
  scheduled_at: string;
  role: Role | null;
};

export function initialValues(item: ContentItemDetail): FormatRoleValues {
  return {
    format: item.format,
    media_kind: item.media_kind,
    production_mode: item.production_mode,
    role: item.role,
    slot: item.slot?.id ?? null,
  };
}

/** Rule 8: keep the media kind and mode when still allowed, otherwise use the registry default. */
export function fillCombination(
  registry: FormatsResponse | undefined,
  next: Pick<FormatRoleValues, 'format' | 'media_kind' | 'production_mode'>,
): Pick<FormatRoleValues, 'format' | 'media_kind' | 'production_mode'> {
  if (!registry) return next;
  const info = registry.formats.find((f) => f.format === next.format);
  const mediaKind =
    info && !info.media_kinds.includes(next.media_kind) ? info.default_media_kind : next.media_kind;
  const spec = registry.specs.find(
    (s) => s.format === next.format && s.media_kind === mediaKind,
  );
  const mode =
    spec && !spec.production_modes.includes(next.production_mode)
      ? spec.default_production_mode
      : next.production_mode;
  return { format: next.format, media_kind: mediaKind, production_mode: mode };
}

const LIVE = ['draft', 'approved'];

export type Consequence =
  | { type: 'warning'; kind: 'brief'; text: string }
  | { type: 'warning'; kind: 'script'; text: string }
  | { type: 'info'; kind: 'slot'; text: string }
  | null;

/**
 * The alert under the fields, computed in the browser from the item and the chosen values; the
 * server checks again. `slotLabel` formats the new slot's time.
 */
export function consequenceOf(
  item: ContentItemDetail,
  values: FormatRoleValues,
  slotLabel: (slotId: number) => string,
): Consequence {
  const brief = item.current_brief && LIVE.includes(item.current_brief.status) ? item.current_brief : null;
  const script =
    item.current_script && LIVE.includes(item.current_script.status) ? item.current_script : null;
  const strong =
    values.format !== item.format ||
    values.media_kind !== item.media_kind ||
    values.role !== item.role;
  const modeChanged = values.production_mode !== item.production_mode;
  const slotChanged = values.slot !== (item.slot?.id ?? null);

  if (strong && brief) {
    return {
      type: 'warning',
      kind: 'brief',
      text: `The brief (v${brief.version}) and any script will be replaced. A new brief is written automatically.`,
    };
  }
  if ((strong || modeChanged) && script) {
    return {
      type: 'warning',
      kind: 'script',
      text: `The script (v${script.version}) will be replaced. The brief stays.`,
    };
  }
  if (slotChanged && !strong && !modeChanged) {
    return {
      type: 'info',
      kind: 'slot',
      text:
        values.slot === null
          ? 'The item leaves its slot. The brief and script stay.'
          : `The item moves to ${slotLabel(values.slot)}. The brief and script stay.`,
    };
  }
  return null;
}

/** Only the fields that changed are sent (rule 7: an empty change returns the item unchanged). */
export function changedFields(
  item: ContentItemDetail,
  values: FormatRoleValues,
): Partial<FormatRoleValues> {
  const before = initialValues(item);
  const out: Partial<FormatRoleValues> = {};
  (Object.keys(before) as (keyof FormatRoleValues)[]).forEach((key) => {
    if (values[key] !== before[key]) {
      (out as Record<string, unknown>)[key] = values[key];
    }
  });
  return out;
}

/** True when the current slot cannot stay because its format no longer matches. */
export function slotMismatch(slot: SlotRef | null, format: Format): boolean {
  return Boolean(slot && slot.format !== format);
}

/** Rule 12 pre-selection: the first open slot whose role matches, else the earliest. */
export function preselectSlot(options: SlotOption[], role: Role | null): number | null {
  if (options.length === 0) return null;
  const sorted = [...options].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const match = role ? sorted.find((o) => o.role === role) : undefined;
  return (match ?? sorted[0]).id;
}

/** Slots must be at least 30 minutes in the future (rule 11). */
export function isBookable(scheduledAt: string, now: number = Date.now()): boolean {
  return new Date(scheduledAt).getTime() - now >= 30 * 60 * 1000;
}
