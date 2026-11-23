import type { ContentLanguage } from '@/services/socialhub/accounts';

export const LANGUAGE_LABEL: Record<ContentLanguage, string> = {
  fa: 'Persian',
  en: 'English',
};

export const LANGUAGE_OPTIONS = (
  Object.keys(LANGUAGE_LABEL) as ContentLanguage[]
).map((value) => ({ value, label: LANGUAGE_LABEL[value] }));

/** `week_start_day`: 0 = Monday … 6 = Sunday (rule 6). */
export const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export const WEEKDAY_OPTIONS = WEEKDAYS.map((label, value) => ({
  value,
  label,
}));

export const DEFAULT_WEEK_START = 5;

/** Handle rule 2 after normalisation. */
export const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

/** Rule 2: leading `@` and surrounding spaces stripped, lowercased. */
export const normalizeHandle = (value: string | undefined | null) =>
  (value ?? '').trim().replace(/^@+/, '').trim().toLowerCase();

export const HANDLE_HELP = 'Letters, numbers, dots and underscores';

export const handleRule = {
  validator: (_: unknown, value: string | undefined) => {
    const handle = normalizeHandle(value);
    if (!handle) return Promise.resolve();
    return HANDLE_PATTERN.test(handle)
      ? Promise.resolve()
      : Promise.reject(
          new Error('Use up to 30 letters, numbers, dots and underscores.'),
        );
  },
};

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

let zones: string[] | null = null;

/** IANA names known to the browser, plus `extra` (for example a stored value it lacks). */
export function timeZoneOptions(...extra: (string | null | undefined)[]) {
  if (!zones) {
    try {
      zones = Intl.supportedValuesOf('timeZone');
    } catch {
      zones = [];
    }
    if (!zones.includes('UTC')) zones = ['UTC', ...zones];
  }
  const all = new Set(zones);
  for (const zone of extra) if (zone) all.add(zone);
  return Array.from(all).map((value) => ({ value, label: value }));
}

/** Query keys for one account's settings, first element the account ID (E00-S02 rule 25). */
export const accountKeys = {
  account: (id: number) => [id, 'account'] as const,
  brand: (id: number) => [id, 'brand'] as const,
};

export const FONTS_QUERY_KEY = ['fonts'] as const;

export const ACCOUNT_TABS = [
  'profile',
  'brand',
  'connection',
  'automation',
] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

export const isAccountTab = (value: string | null): value is AccountTab =>
  !!value && (ACCOUNT_TABS as readonly string[]).includes(value);

/** Rule 11: publishing can be turned on only while connected or expiring. */
export const canPublish = (connectionStatus: string) =>
  connectionStatus === 'connected' || connectionStatus === 'expiring';
