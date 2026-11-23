import { beforeEach, describe, expect, it, vi } from 'vitest';

const { history, warning, clear } = vi.hoisted(() => ({
  history: {
    location: { pathname: '/plans/7', search: '?tab=slots', hash: '' },
    replace: vi.fn(),
  },
  warning: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('@umijs/max', () => ({ history }));
vi.mock('antd', () => ({ message: { warning }, notification: {} }));
vi.mock('./queryClient', () => ({ queryClient: { clear } }));

import {
  endSession,
  getSafeRedirectUrl,
  loginPath,
  onSessionEnded,
  sessionStarted,
} from './session';

describe('getSafeRedirectUrl', () => {
  it('keeps same-origin paths with query and hash', () => {
    expect(getSafeRedirectUrl('/plans/7?tab=slots#x')).toBe(
      '/plans/7?tab=slots#x',
    );
  });

  it.each([
    null,
    '',
    'https://evil.example/',
    '//evil.example/x',
    'javascript:alert(1)',
    '/user/login',
  ])('falls back to /overview for %s', (value) => {
    expect(getSafeRedirectUrl(value)).toBe('/overview');
  });
});

describe('loginPath', () => {
  it('encodes the path, query and hash', () => {
    expect(
      loginPath({ pathname: '/content/4', search: '?tab=brief', hash: '#a' }),
    ).toBe(`/user/login?redirect=${encodeURIComponent('/content/4?tab=brief#a')}`);
  });
});

describe('endSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStarted();
    history.location = { pathname: '/plans/7', search: '?tab=slots', hash: '' };
  });

  it('clears state, says why and redirects once for many failures', () => {
    const listener = vi.fn();
    const off = onSessionEnded(listener);
    endSession();
    endSession();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('Your session ended. Sign in again.');
    expect(history.replace).toHaveBeenCalledTimes(1);
    expect(history.replace).toHaveBeenCalledWith(
      `/user/login?redirect=${encodeURIComponent('/plans/7?tab=slots')}`,
    );
    off();
  });

  it('handles a later expiry again after a new sign-in', () => {
    endSession();
    sessionStarted();
    endSession();
    expect(history.replace).toHaveBeenCalledTimes(2);
  });

  it('does nothing on the sign-in page', () => {
    history.location = { pathname: '/user/login', search: '', hash: '' };
    endSession();
    expect(history.replace).not.toHaveBeenCalled();
  });
});
