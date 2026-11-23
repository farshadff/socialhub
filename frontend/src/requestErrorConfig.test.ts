import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/socialhub/http';

const { endSession, ensureCsrf } = vi.hoisted(() => ({
  endSession: vi.fn(),
  ensureCsrf: vi.fn(),
}));

vi.mock('@/utils/session', () => ({ endSession }));
vi.mock('@/services/socialhub/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/http')>()),
  ensureCsrf,
}));

import { csrfInterceptor, errorConfig, toApiError } from './requestErrorConfig';

// biome-ignore lint/style/noNonNullAssertion: the handler is always defined
const errorHandler = errorConfig.errorConfig!.errorHandler!;

const setCookie = (value: string | null) => {
  // biome-ignore lint/suspicious/noDocumentCookie: tests set the CSRF cookie directly
  document.cookie =
    value === null
      ? 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
      : `csrftoken=${value}; path=/`;
};

const axiosError = (
  status: number,
  data: unknown,
  url = '/api/v1/plans/',
  headers: Record<string, string> = {},
) => ({
  message: `Request failed with status code ${status}`,
  config: { url },
  response: { status, data, headers, statusText: 'Error' },
});

const authRequired = {
  error: {
    code: 'authentication_required',
    message: '…',
    fields: [],
    request_id: 'req-9',
    retryable: false,
  },
};

describe('csrfInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCookie(null);
  });

  it('adds X-CSRFToken to mutating requests only', async () => {
    setCookie('tok123');
    for (const method of ['post', 'PUT', 'patch', 'DELETE']) {
      const config = await csrfInterceptor({ method, headers: {} });
      expect(config.headers['X-CSRFToken']).toBe('tok123');
    }
    for (const method of ['get', 'HEAD', 'OPTIONS', undefined]) {
      const config = await csrfInterceptor({ method, headers: {} });
      expect(config.headers['X-CSRFToken']).toBeUndefined();
    }
    expect(ensureCsrf).not.toHaveBeenCalled();
  });

  it('fetches a token first when the cookie is missing', async () => {
    ensureCsrf.mockResolvedValue('fresh');
    const config = await csrfInterceptor({ method: 'POST', headers: {} });
    expect(ensureCsrf).toHaveBeenCalledTimes(1);
    expect(config.headers['X-CSRFToken']).toBe('fresh');
  });

  it('uses AxiosHeaders.set when the headers object has one', async () => {
    setCookie('tok');
    const set = vi.fn();
    await csrfInterceptor({ method: 'POST', headers: { set } });
    expect(set).toHaveBeenCalledWith('X-CSRFToken', 'tok');
  });
});

describe('toApiError', () => {
  it('keeps the Social Hub error shape', () => {
    const error = toApiError(
      axiosError(
        400,
        {
          error: {
            code: 'validation_error',
            message: 'پیام',
            fields: [{ path: 'title', code: 'blank', message: '…' }],
            request_id: 'req-1',
            retryable: false,
            details: { undecided: [3] },
          },
        },
        '/api/v1/plans/',
      ),
    ) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('validation_error');
    expect(error.fields).toHaveLength(1);
    expect(error.request_id).toBe('req-1');
    expect(error.details).toEqual({ undecided: [3] });
  });

  it('reads Retry-After for rate limiting', () => {
    const error = toApiError(
      axiosError(
        429,
        { error: { code: 'rate_limited', message: '', retryable: true } },
        '/api/v1/auth/login/',
        { 'retry-after': '840' },
      ),
    ) as ApiError;
    expect(error.retryAfter).toBe(840);
    expect(error.retryable).toBe(true);
  });

  it('maps a non-JSON 502 or 503 to api_restarting', () => {
    expect((toApiError(axiosError(502, '<html>')) as ApiError).code).toBe(
      'api_restarting',
    );
    expect((toApiError(axiosError(503, '')) as ApiError).code).toBe(
      'api_restarting',
    );
    expect((toApiError(axiosError(500, '<html>')) as ApiError).code).toBe(
      'server_error',
    );
    expect((toApiError(axiosError(404, '')) as ApiError).code).toBe(
      'request_error',
    );
  });

  it('maps a request without a response to network_error', () => {
    expect((toApiError({ message: 'Network Error' }) as ApiError).code).toBe(
      'network_error',
    );
  });

  it('passes cancellations through unchanged', () => {
    const canceled = { name: 'CanceledError', code: 'ERR_CANCELED' };
    expect(toApiError(canceled)).toBe(canceled);
  });
});

describe('errorHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always rethrows the normalised ApiError', () => {
    expect(() => errorHandler(axiosError(409, {}) as any, {})).toThrow(
      ApiError,
    );
  });

  it('ends the session on authentication_required from a protected endpoint', () => {
    expect(() =>
      errorHandler(axiosError(403, authRequired) as any, {}),
    ).toThrow();
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it('does not redirect when /auth/me/ itself returns it (no loop)', () => {
    expect(() =>
      errorHandler(
        axiosError(403, authRequired, '/api/v1/auth/me/') as any,
        {},
      ),
    ).toThrow();
    expect(endSession).not.toHaveBeenCalled();
  });

  it('does not redirect when the caller skips the error handler', () => {
    expect(() =>
      errorHandler(axiosError(403, authRequired) as any, {
        skipErrorHandler: true,
      }),
    ).toThrow();
    expect(endSession).not.toHaveBeenCalled();
  });

  it('does not end the session on permission_denied', () => {
    expect(() =>
      errorHandler(
        axiosError(403, {
          error: { code: 'permission_denied', message: '' },
        }) as any,
        {},
      ),
    ).toThrow();
    expect(endSession).not.toHaveBeenCalled();
  });
});
