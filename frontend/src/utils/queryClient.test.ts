import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/socialhub/http';

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('antd', () => ({ notification: { error } }));

import { handleMutationError, queryClient } from './queryClient';

const apiError = (status: number, code: string) =>
  new ApiError(status, { code, message: 'پیام', request_id: 'req-42' });

describe('default mutation handling (rule 34)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notifies with the English text and the reference (acceptance 10)', () => {
    handleMutationError(apiError(503, 'provider_not_configured'), {});
    expect(error).toHaveBeenCalledWith({
      title:
        "A required integration isn't set up. Ask an admin to check Settings → System.",
      description: 'Reference: req-42',
    });
  });

  it('stays quiet when the caller handles the error itself', () => {
    handleMutationError(apiError(400, 'validation_error'), {
      onError: () => undefined,
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('calls the reload callback on 409', () => {
    const onConflict = vi.fn();
    handleMutationError(apiError(409, 'version_conflict'), {
      meta: { onConflict },
    });
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('does not retry mutations and retries queries once', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(false);
    expect(defaults.queries?.retry).toBe(1);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });
});
