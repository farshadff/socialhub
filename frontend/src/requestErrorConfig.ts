import type { RequestConfig } from '@umijs/max';
import {
  ApiError,
  type ApiErrorBody,
  ensureCsrf,
  readCookie,
} from '@/services/socialhub/http';
import { endSession } from '@/utils/session';

/**
 * The Social Hub request layer (E00-S01 FE1, E00-S02 FE5) for Umi's `request`, which every call in
 * `src/services/socialhub/` goes through.
 *
 * - Request: `X-CSRFToken` on every mutating request; when the `csrftoken` cookie is missing it
 *   first calls `GET /auth/csrf/`.
 * - Response: any failure becomes an `ApiError` with the API's error contract (docs/API.md); a
 *   `403 authentication_required` from any endpoint other than `/auth/me/` ends the session.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type InterceptedConfig = {
  url?: string;
  method?: string;
  headers?: any;
  [key: string]: any;
};

function setHeader(config: InterceptedConfig, name: string, value: string) {
  if (typeof config.headers?.set === 'function') {
    config.headers.set(name, value);
  } else {
    config.headers = { ...config.headers, [name]: value };
  }
}

/** Adds `X-CSRFToken` to non-`GET` requests (Django rejects them otherwise with `csrf_failed`). */
export async function csrfInterceptor(
  config: InterceptedConfig,
): Promise<InterceptedConfig> {
  const method = (config.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return config;
  const token = readCookie('csrftoken') ?? (await ensureCsrf());
  if (token) setHeader(config, 'X-CSRFToken', token);
  return config;
}

const isCanceled = (error: any) =>
  error?.code === 'ERR_CANCELED' ||
  error?.name === 'CanceledError' ||
  error?.name === 'AbortError';

const parseRetryAfter = (value: unknown): number | null => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
};

/** Turns an Axios error (or anything thrown) into an `ApiError`; cancellations pass through. */
export function toApiError(error: any): unknown {
  if (error instanceof ApiError || isCanceled(error)) return error;
  const response = error?.response;
  if (!response) {
    return new ApiError(0, {
      code: 'network_error',
      message: error?.message ?? 'Network error',
    });
  }
  const { status, data, headers } = response;
  const retryAfter = parseRetryAfter(
    headers?.['retry-after'] ??
      (typeof headers?.get === 'function' ? headers.get('retry-after') : null),
  );
  const body: ApiErrorBody | undefined =
    data && typeof data === 'object' && typeof data.error?.code === 'string'
      ? data.error
      : undefined;
  if (body) return new ApiError(status, body, { retryAfter });
  // Not the API's JSON error: a proxy page or an empty body.
  const code =
    status === 502 || status === 503
      ? 'api_restarting'
      : status >= 500
        ? 'server_error'
        : 'request_error';
  return new ApiError(
    status,
    { code, message: response.statusText || code },
    { retryAfter },
  );
}

const isMeRequest = (url?: string) => !!url && /\/auth\/me\/?(\?|$)/.test(url);

export const errorConfig: RequestConfig = {
  errorConfig: {
    /** Always rethrows the normalised error; Umi rejects the request with it. */
    errorHandler: (error: any, opts: any) => {
      const normalised = toApiError(error);
      if (
        normalised instanceof ApiError &&
        normalised.status === 403 &&
        normalised.code === 'authentication_required' &&
        !opts?.skipErrorHandler &&
        !isMeRequest(error?.config?.url)
      ) {
        endSession();
      }
      throw normalised;
    },
  },
  requestInterceptors: [csrfInterceptor as any],
  responseInterceptors: [],
};
