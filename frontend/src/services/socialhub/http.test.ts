import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@umijs/max', () => ({ request }));

import {
  ApiError,
  api,
  apiRequest,
  buildQuery,
  RESTART_RETRY_MS,
} from './http';

const ok = (data: unknown, status = 200) => ({ status, data });

describe('buildQuery', () => {
  it('drops empty values and joins lists with commas', () => {
    expect(
      buildQuery({ account: 3, status: ['open', 'reserved'], q: '', x: null }),
    ).toBe('?account=3&status=open%2Creserved');
    expect(buildQuery({})).toBe('');
  });
});

describe('apiRequest', () => {
  beforeEach(() => request.mockReset());
  afterEach(() => vi.useRealTimers());

  it('calls the API prefix with the body and merged headers', async () => {
    request.mockResolvedValue(ok({ id: 1 }, 201));
    const data = await apiRequest('POST', '/selection/confirm/', {
      body: { plan: 4 },
      headers: { 'Idempotency-Key': 'abcdefgh' },
    });
    expect(data).toEqual({ id: 1 });
    expect(request).toHaveBeenCalledWith(
      '/api/v1/selection/confirm/',
      expect.objectContaining({
        method: 'POST',
        data: { plan: 4 },
        getResponse: true,
        headers: { Accept: 'application/json', 'Idempotency-Key': 'abcdefgh' },
      }),
    );
  });

  it('passes headers through the convenience methods', async () => {
    request.mockResolvedValue(ok({}));
    await api.post('/x/', undefined, { headers: { 'Idempotency-Key': 'k' } });
    expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe('k');
    expect(request.mock.calls[0][1].data).toEqual({});
  });

  it('returns undefined for 204', async () => {
    request.mockResolvedValue(ok('', 204));
    await expect(api.delete('/slots/1/')).resolves.toBeUndefined();
  });

  it('retries a GET once after 2 seconds while the API restarts', async () => {
    vi.useFakeTimers();
    request
      .mockRejectedValueOnce(
        new ApiError(503, { code: 'api_restarting', message: '' }),
      )
      .mockResolvedValueOnce(ok({ results: [] }));
    const promise = api.get('/plans/', { account: 1 });
    await vi.advanceTimersByTimeAsync(RESTART_RETRY_MS);
    await expect(promise).resolves.toEqual({ results: [] });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry a mutation', async () => {
    request.mockRejectedValue(
      new ApiError(503, { code: 'api_restarting', message: '' }),
    );
    await expect(api.post('/plans/', {})).rejects.toMatchObject({
      code: 'api_restarting',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
