import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/socialhub/http';

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  sessionStarted: vi.fn(),
  history: {
    location: { pathname: '/plans', search: '', hash: '' },
    replace: vi.fn(),
  },
}));

vi.mock('@umijs/max', () => ({
  history: mocks.history,
  Link: ({ children }: any) => children,
  useModel: () => ({ setInitialState: vi.fn() }),
}));

vi.mock('@/services/socialhub/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/auth')>()),
  getMe: mocks.getMe,
}));

vi.mock('@/utils/session', () => ({
  isAuthPath: (path: string) => path.startsWith('/user/'),
  loginPath: (location: { pathname: string; search: string; hash: string }) =>
    `/user/login?redirect=${encodeURIComponent(
      `${location.pathname}${location.search}${location.hash}`,
    )}`,
  onSessionEnded: () => () => undefined,
  sessionStarted: mocks.sessionStarted,
}));

vi.mock('@/components', () => ({
  AccountSwitcher: () => null,
  AttentionBadge: () => null,
  AvatarDropdown: () => null,
  ConnectionIndicator: () => null,
  ErrorBoundary: ({ children }: any) => children,
  Footer: () => null,
  OfflineBanner: () => null,
  PublishingIndicator: () => null,
}));
vi.mock('@/pages/exception/403', () => ({ default: () => null }));
vi.mock('@/pages/exception/404', () => ({ default: () => null }));
vi.mock('@ant-design/pro-components', () => ({ SettingDrawer: () => null }));
vi.mock('./requestErrorConfig', () => ({ errorConfig: {} }));
vi.mock('../config/defaultSettings', () => ({
  default: { navTheme: 'light' },
}));

import { getInitialState, layout } from './app';

const user = {
  id: 1,
  username: 'admin',
  full_name: 'admin',
  email: '',
  role: 'admin' as const,
};

describe('session bootstrap (E00-S01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.history.location = { pathname: '/plans', search: '', hash: '' };
  });

  it('maps GET /auth/me/ to currentUser', async () => {
    mocks.getMe.mockResolvedValue({ user });
    const state = await getInitialState();
    expect(state.currentUser).toEqual({
      id: 1,
      name: 'admin',
      username: 'admin',
      email: '',
      access: 'admin',
    });
    expect(state.settings).toEqual({ navTheme: 'light' });
    expect(state.settingDrawerOpen).toBe(false);
    expect(mocks.history.replace).not.toHaveBeenCalled();
    expect(mocks.sessionStarted).toHaveBeenCalled();
  });

  it('uses the full name when there is one', async () => {
    mocks.getMe.mockResolvedValue({
      user: { ...user, full_name: 'Sara Moradi', role: 'operator' },
    });
    const state = await getInitialState();
    expect(state.currentUser?.name).toBe('Sara Moradi');
    expect(state.currentUser?.access).toBe('operator');
  });

  it('redirects to sign-in with the path, query and hash on authentication_required', async () => {
    mocks.history.location = {
      pathname: '/content/4',
      search: '?tab=brief',
      hash: '#top',
    };
    mocks.getMe.mockRejectedValue(
      new ApiError(403, { code: 'authentication_required', message: '' }),
    );
    const state = await getInitialState();
    expect(state.currentUser).toBeUndefined();
    expect(mocks.history.replace).toHaveBeenCalledWith(
      `/user/login?redirect=${encodeURIComponent('/content/4?tab=brief#top')}`,
    );
  });

  it('does not redirect from /user/ pages', async () => {
    mocks.history.location = { pathname: '/user/login', search: '', hash: '' };
    mocks.getMe.mockRejectedValue(
      new ApiError(403, { code: 'authentication_required', message: '' }),
    );
    const state = await getInitialState();
    expect(state.currentUser).toBeUndefined();
    expect(mocks.history.replace).not.toHaveBeenCalled();
  });

  it('repeats the check on navigation when the session has ended', () => {
    const config = layout({
      initialState: { currentUser: undefined },
      setInitialState: vi.fn(),
    } as any);
    (config.onPageChange as () => void)();
    expect(mocks.history.replace).toHaveBeenCalledWith(
      `/user/login?redirect=${encodeURIComponent('/plans')}`,
    );
  });

  it('titles the browser tab "{Page title} · Social Hub"', () => {
    const config = layout({ initialState: {}, setInitialState: vi.fn() } as any);
    const render = config.pageTitleRender as (...args: any[]) => string;
    expect(render({}, '', { pageName: 'Weekly plan', title: 'Social Hub' })).toBe(
      'Weekly plan · Social Hub',
    );
    expect(render({}, '', { pageName: '', title: 'Social Hub' })).toBe(
      'Social Hub',
    );
  });
});
