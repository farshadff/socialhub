import type {
  AiDisclosure,
  BrandColorKey,
  BrandColors,
  BrandFonts,
  BrandProfile,
  BrandUpdate,
} from '@/services/socialhub/accounts';

/** The Brand tab's form values: every editable field (rule 16). */
export type BrandFormValues = {
  colors: BrandColors;
  fonts: BrandFonts;
  tone_of_voice: string;
  audience_summary: string;
  handle_display: string;
  ai_disclosure: AiDisclosure;
  content_pillars: string[];
  default_hashtags: string[];
  banned_terms: string[];
  cta_examples: string[];
};

export const COLOR_FIELDS: { key: BrandColorKey; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
];

export const AI_DISCLOSURE_OPTIONS: { value: AiDisclosure; label: string }[] = [
  { value: 'generated_only', label: 'Label AI-generated assets only' },
  { value: 'always', label: 'Always label' },
  { value: 'never', label: 'Never label' },
];

export type ListFieldName =
  | 'content_pillars'
  | 'default_hashtags'
  | 'banned_terms'
  | 'cta_examples';

/** Rule 19 list limits. */
export const LIST_FIELDS: {
  name: ListFieldName;
  label: string;
  max: number;
  maxItemLength: number;
  hashtag?: boolean;
}[] = [
  {
    name: 'content_pillars',
    label: 'Content pillars',
    max: 10,
    maxItemLength: 80,
  },
  {
    name: 'default_hashtags',
    label: 'Default hashtags',
    max: 30,
    maxItemLength: 100,
    hashtag: true,
  },
  { name: 'banned_terms', label: 'Banned terms', max: 100, maxItemLength: 80 },
  { name: 'cta_examples', label: 'CTA examples', max: 10, maxItemLength: 200 },
];

export const TEXT_LIMITS = {
  tone_of_voice: 2000,
  audience_summary: 2000,
  handle_display: 40,
};

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/svg+xml'];

export function formValuesFrom(brand: BrandProfile): BrandFormValues {
  return {
    colors: { ...brand.colors },
    fonts: { ...brand.fonts },
    tone_of_voice: brand.tone_of_voice,
    audience_summary: brand.audience_summary,
    handle_display: brand.handle_display,
    ai_disclosure: brand.ai_disclosure,
    content_pillars: [...brand.content_pillars],
    default_hashtags: [...brand.default_hashtags],
    banned_terms: [...brand.banned_terms],
    cta_examples: [...brand.cta_examples],
  };
}

const COLOR_KEYS = COLOR_FIELDS.map((field) => field.key);

export function toBrandUpdate(values: BrandFormValues): BrandUpdate {
  const colors = Object.fromEntries(
    COLOR_KEYS.map((key) => [key, (values.colors?.[key] ?? '').toUpperCase()]),
  ) as BrandColors;
  return {
    colors,
    fonts: { heading: values.fonts?.heading, body: values.fonts?.body },
    tone_of_voice: values.tone_of_voice ?? '',
    audience_summary: values.audience_summary ?? '',
    content_pillars: values.content_pillars ?? [],
    default_hashtags: values.default_hashtags ?? [],
    banned_terms: values.banned_terms ?? [],
    cta_examples: values.cta_examples ?? [],
    handle_display: (values.handle_display ?? '').trim(),
    ai_disclosure: values.ai_disclosure,
  };
}

/** Trims items, drops empty ones and repeats (case-insensitive for hashtags, rule 19). */
export function normalizeList(values: unknown, hashtag = false): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    let item = String(raw).trim();
    if (hashtag) item = item.replace(/^#+/, '').trim();
    if (!item) continue;
    const key = hashtag ? item.toLocaleLowerCase() : item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Validation for one tag list (rule 19): item count, item length, and the hashtag pattern. */
export function listProblem(
  items: string[] | undefined,
  limits: { max: number; maxItemLength: number; hashtag?: boolean },
): string | null {
  const list = items ?? [];
  if (list.length > limits.max) return `Up to ${limits.max} items.`;
  if (list.some((item) => item.length > limits.maxItemLength)) {
    return `Each item can have up to ${limits.maxItemLength} characters.`;
  }
  if (limits.hashtag && list.some((item) => /[\s#]/.test(item))) {
    return "Hashtags can't contain spaces or #.";
  }
  return null;
}

/** What `complete` needs (rule 21), as the info alert lists it. */
export function missingForComplete(brand: BrandProfile): string[] {
  const missing: string[] = [];
  if (!brand.logo_light) missing.push('Add a logo for light backgrounds');
  if (!brand.tone_of_voice.trim()) missing.push('Describe the tone of voice');
  if (!brand.fonts.heading || !brand.fonts.body) {
    missing.push('Choose the heading and body fonts');
  }
  return missing;
}

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hexColor: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hexColor.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** WCAG contrast ratio between two `#RRGGBB` colours, or null when one is malformed. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** English text for the `low_contrast` warning, with the ratio of the saved colours. */
export function lowContrastText(colors: BrandColors): string {
  const ratio = contrastRatio(colors.text, colors.background);
  const measured = ratio === null ? '' : ` is ${ratio.toFixed(2)}:1`;
  return `Text on background contrast${measured}; 4.5:1 or more is recommended. The brand profile is saved, but text may be hard to read.`;
}
