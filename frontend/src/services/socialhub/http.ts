/**
 * Client for the Social Hub API (`/api/v1/`), docs/API.md section 1.
 *
 * Every call goes through Umi's `request`, so the request layer in `src/requestErrorConfig.ts`
 * applies to all of them:
 * - `X-CSRFToken` on every mutating request (fetching the token first when the cookie is missing);
 * - errors become a typed `ApiError` carrying the API's error contract;
 * - `403 authentication_required` ends the session and sends the browser to sign-in.
 *
 * A non-JSON `502`/`503` means the API is restarting: `GET` requests are retried once after
 * 2 seconds (docs/DESIGN-SYSTEM.md section 7).
 *
 * Errors are not shown here. Queries render them with `PageError`; mutations either run through
 * TanStack `useMutation` (a default notification unless the caller passes its own `onError`, see
 * `src/utils/queryClient.ts`) or handle them in place with `notifyError` / `applyFieldErrors`.
 */
type UmiRequest = typeof import('@umijs/max')['request'];

let requestModule: Promise<UmiRequest> | null = null;

/**
 * Umi's `request`, loaded on first use. Importing this module (for `ApiError`, types or helpers)
 * therefore never loads the Umi runtime, which keeps unit tests of pages and components light.
 */
const umiRequest = (): Promise<UmiRequest> => {
  requestModule ??= import('@umijs/max').then((umi) => umi.request);
  return requestModule;
};

export const API_PREFIX = '/api/v1';

export type FieldError = {
  path: string;
  code: string;
  message: string;
  /** Present on some codes, for example `unsupported_media`. */
  reason?: string;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  fields?: FieldError[];
  request_id?: string;
  retryable?: boolean;
  details?: Record<string, any>;
};

export class ApiError extends Error {
  status: number;
  code: string;
  fields: FieldError[];
  request_id: string | null;
  retryable: boolean;
  details: Record<string, any>;
  /** `Retry-After` in seconds, when the response carried one. */
  retryAfter: number | null;

  constructor(
    status: number,
    body: ApiErrorBody,
    extra: { retryAfter?: number | null } = {},
  ) {
    super(body.message || body.code);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? [];
    this.request_id = body.request_id ?? null;
    this.retryable = Boolean(body.retryable);
    this.details = body.details ?? {};
    this.retryAfter = extra.retryAfter ?? null;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Paginated list shape used by every list endpoint. */
export type Page<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number>;

export type QueryParams = Record<string, QueryValue>;

/** Builds `?a=1&b=x,y`; empty values are dropped and lists are comma-separated (API.md). */
export function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (raw === undefined || raw === null || raw === '') continue;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      search.set(key, raw.join(','));
    } else {
      search.set(key, String(raw));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RequestOptions = {
  params?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  /** Extra headers, merged after the defaults (for example `Idempotency-Key`). */
  headers?: Record<string, string>;
  /** Skip the session-ended redirect; used by `GET /auth/me/` during bootstrap. */
  skipErrorHandler?: boolean;
};

export type MutationOptions = Pick<RequestOptions, 'headers'>;

/** Time before a `GET` is retried while the API restarts. */
export const RESTART_RETRY_MS = 2000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions,
): Promise<T> {
  const request = await umiRequest();
  const response = (await request(
    `${API_PREFIX}${path}${buildQuery(options.params)}`,
    {
      method,
      data: options.body,
      signal: options.signal,
      headers: { Accept: 'application/json', ...options.headers },
      skipErrorHandler: options.skipErrorHandler,
      getResponse: true,
    },
  )) as { status: number; data: unknown };
  return (response.status === 204 ? undefined : response.data) as T;
}

export async function apiRequest<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await send<T>(method, path, options);
  } catch (error) {
    if (
      method === 'GET' &&
      isApiError(error) &&
      error.code === 'api_restarting' &&
      !options.signal?.aborted
    ) {
      await wait(RESTART_RETRY_MS);
      return send<T>(method, path, options);
    }
    throw error;
  }
}

export const api = {
  get: <T>(path: string, params?: QueryParams, signal?: AbortSignal) =>
    apiRequest<T>('GET', path, { params, signal }),
  post: <T>(path: string, body?: unknown, options?: MutationOptions) =>
    apiRequest<T>('POST', path, { body: body ?? {}, ...options }),
  patch: <T>(path: string, body: unknown, options?: MutationOptions) =>
    apiRequest<T>('PATCH', path, { body, ...options }),
  put: <T>(path: string, body: unknown, options?: MutationOptions) =>
    apiRequest<T>('PUT', path, { body, ...options }),
  delete: (path: string, options?: MutationOptions) =>
    apiRequest<void>('DELETE', path, { ...options }),
};

let csrfPromise: Promise<string | null> | null = null;

/**
 * Makes sure the `csrftoken` cookie is set, calling `GET /auth/csrf/` at most once at a time.
 * Resolves to the token, or null when the server can't be reached (the next mutation reports it).
 */
export function ensureCsrf(): Promise<string | null> {
  const existing = readCookie('csrftoken');
  if (existing) return Promise.resolve(existing);
  if (!csrfPromise) {
    csrfPromise = api
      .get<{ csrf_token: string }>('/auth/csrf/')
      .then((data) => readCookie('csrftoken') ?? data?.csrf_token ?? null)
      .catch(() => null)
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}
