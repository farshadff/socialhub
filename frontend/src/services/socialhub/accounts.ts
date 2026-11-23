/**
 * Instagram accounts, brand profiles and bundled fonts (E00-S03,
 * docs/epics/E00-foundation/S03-accounts-and-brand.md). Not account-scoped: `/accounts/` and
 * `/fonts/` take no `account` parameter.
 */
import { api, type Page } from './http';

export type ContentLanguage = 'fa' | 'en';

export type AccountStatus = 'active' | 'archived';

export type ConnectionStatus =
  | 'connected'
  | 'expiring'
  | 'needs_attention'
  | 'disconnected';

/** Rule 8 limits. */
export type PostingRules = {
  min_gap_minutes: number;
  max_feed_per_day: number;
  max_stories_per_day: number;
  max_revisions: number;
};

export type Autopilot = { selection: boolean; brief: boolean; script: boolean };

/**
 * The account representation. The API always returns every field; the ones marked optional are
 * optional only so older test fixtures that predate E00-S03 keep compiling.
 */
export type Account = {
  id: number;
  handle: string;
  display_name: string;
  timezone: string;
  content_language: ContentLanguage;
  /** 0 = Monday … 6 = Sunday. */
  week_start_day: number;
  status: AccountStatus;
  publishing_enabled: boolean;
  autopilot: Autopilot;
  posting_rules?: PostingRules;
  notes?: string;
  /** Computed by the API; a `manual` connection is always `connected`. */
  connection_status: ConnectionStatus | string;
  connection_provider?: string;
  brand_complete?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AccountListParams = {
  /** Omitted returns both statuses. */
  status?: AccountStatus;
  search?: string;
  page?: number;
  page_size?: number;
};

export type AccountCreate = {
  handle: string;
  display_name: string;
  timezone?: string;
  content_language?: ContentLanguage;
  week_start_day?: number;
  notes?: string;
};

/** `PATCH` body: any subset; `handle`, `status`, `publishing_enabled`, `autopilot` are admin-only. */
export type AccountUpdate = Partial<{
  handle: string;
  display_name: string;
  timezone: string;
  content_language: ContentLanguage;
  week_start_day: number;
  notes: string;
  status: AccountStatus;
  publishing_enabled: boolean;
  autopilot: Partial<Autopilot>;
  posting_rules: Partial<PostingRules>;
}>;

/** Active accounts for the switcher, ordered by handle by the API. */
export const listAccounts = () =>
  api.get<Page<Account>>('/accounts/', { status: 'active', page_size: 100 });

/** The Settings → Accounts table: both statuses unless `status` is given. */
export const searchAccounts = (params: AccountListParams = {}) =>
  api.get<Page<Account>>('/accounts/', params);

export const getAccount = (id: number) => api.get<Account>(`/accounts/${id}/`);

/** Admin only. */
export const createAccount = (body: AccountCreate) =>
  api.post<Account>('/accounts/', body);

export const updateAccount = (id: number, body: AccountUpdate) =>
  api.patch<Account>(`/accounts/${id}/`, body);

// ── Brand profile ────────────────────────────────────────────────────────────────────────────

export type BrandColorKey =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'background'
  | 'text';

/** Each value `#RRGGBB`, stored uppercase. */
export type BrandColors = Record<BrandColorKey, string>;

export type BrandFonts = { heading: string; body: string };

export type AiDisclosure = 'generated_only' | 'always' | 'never';

export type LogoVariant = 'light' | 'dark';

export type BrandWarning = { path: string; code: string; message: string };

export type BrandProfile = {
  account: number;
  logo_light: string | null;
  logo_dark: string | null;
  colors: BrandColors;
  fonts: BrandFonts;
  tone_of_voice: string;
  audience_summary: string;
  content_pillars: string[];
  default_hashtags: string[];
  banned_terms: string[];
  cta_examples: string[];
  handle_display: string;
  ai_disclosure: AiDisclosure;
  complete: boolean;
  warnings: BrandWarning[];
  updated_at: string;
};

/** `PUT` body: every editable field; the logos only as `null` to remove one (rule 16). */
export type BrandUpdate = Pick<
  BrandProfile,
  | 'colors'
  | 'fonts'
  | 'tone_of_voice'
  | 'audience_summary'
  | 'content_pillars'
  | 'default_hashtags'
  | 'banned_terms'
  | 'cta_examples'
  | 'handle_display'
  | 'ai_disclosure'
> & { logo_light?: null; logo_dark?: null };

export const getBrand = (accountId: number) =>
  api.get<BrandProfile>(`/accounts/${accountId}/brand/`);

export const updateBrand = (accountId: number, body: BrandUpdate) =>
  api.put<BrandProfile>(`/accounts/${accountId}/brand/`, body);

/** Multipart `file` + `variant`; PNG or SVG up to 2 MB (rule 22). Returns the brand profile. */
export function uploadLogo(
  accountId: number,
  variant: LogoVariant,
  file: File | Blob,
) {
  const form = new FormData();
  form.append('file', file);
  form.append('variant', variant);
  return api.post<BrandProfile>(`/accounts/${accountId}/brand/logo/`, form);
}

/** The editable fields of a brand profile, as the `PUT` expects them. */
export function brandUpdateFrom(brand: BrandProfile): BrandUpdate {
  return {
    colors: brand.colors,
    fonts: brand.fonts,
    tone_of_voice: brand.tone_of_voice,
    audience_summary: brand.audience_summary,
    content_pillars: brand.content_pillars,
    default_hashtags: brand.default_hashtags,
    banned_terms: brand.banned_terms,
    cta_examples: brand.cta_examples,
    handle_display: brand.handle_display,
    ai_disclosure: brand.ai_disclosure,
  };
}

// ── Fonts ────────────────────────────────────────────────────────────────────────────────────

export type BrandFont = {
  key: string;
  name: string;
  scripts: string[];
  weights: number[];
  /** Weight → file URL. */
  files: Record<string, string>;
};

/** Bundled fonts (rule 24). Not paginated. */
export const listFonts = () => api.get<{ results: BrandFont[] }>('/fonts/');
