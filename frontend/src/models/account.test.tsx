import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';
import type { Account } from '@/services/socialhub/accounts';

const { history, listAccounts, invalidateQueries, state } = vi.hoisted(() => ({
  history: { location: { pathname: '/plans' }, push: vi.fn() },
  listAccounts: vi.fn(),
  invalidateQueries: vi.fn(),
  state: { userId: 1 as number | null },
}));

vi.mock('@umijs/max', () => ({
  history,
  useModel: () => ({
    initialState: {
      currentUser: state.userId === null ? undefined : { id: state.userId },
    },
  }),
}));
vi.mock('@/services/socialhub/accounts', () => ({ listAccounts }));
vi.mock('@/utils/queryClient', () => ({
  queryClient: { invalidateQueries },
}));

import { ACCOUNT_STORAGE_KEY, withAccount } from '@/utils/accountRequest';
import useAccountModel from './account';

const account = (id: number, handle: string): Account => ({
  id,
  handle,
  display_name: handle,
  timezone: 'UTC',
  content_language: 'en',
  week_start_day: 0,
  status: 'active',
  publishing_enabled: false,
  autopilot: { selection: false, brief: false, script: false },
  connection_status: 'connected',
});

const page = (results: Account[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

describe('account model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    state.userId = 1;
    history.location = { pathname: '/plans' };
  });

  it('selects the first account by handle and stores it', async () => {
    listAccounts.mockResolvedValue(
      page([account(2, 'zeta'), account(1, 'alpha')]),
    );
    const { result } = await renderHook(() => useAccountModel());
    await expect.poll(() => result.current.currentAccountId).toBe(1);
    expect(result.current.accounts.map((a) => a.handle)).toEqual([
      'alpha',
      'zeta',
    ]);
    expect(window.localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe('1');
    expect(withAccount({})).toEqual({ account: 1 });
  });

  it('restores the stored account after a reload (acceptance 3)', async () => {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, '2');
    listAccounts.mockResolvedValue(
      page([account(1, 'alpha'), account(2, 'zeta')]),
    );
    const { result } = await renderHook(() => useAccountModel());
    await expect.poll(() => result.current.currentAccountId).toBe(2);
  });

  it('replaces a stored ID that no longer exists (acceptance 4)', async () => {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, '99');
    listAccounts.mockResolvedValue(page([account(1, 'alpha')]));
    const { result } = await renderHook(() => useAccountModel());
    await expect.poll(() => result.current.currentAccountId).toBe(1);
    expect(window.localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe('1');
  });

  it('switching stores the ID, invalidates the old account and stays on a list page', async () => {
    listAccounts.mockResolvedValue(
      page([account(1, 'alpha'), account(2, 'zeta')]),
    );
    const { result } = await renderHook(() => useAccountModel());
    await expect.poll(() => result.current.currentAccountId).toBe(1);
    await act(async () => result.current.setCurrentAccount(2));
    expect(result.current.currentAccountId).toBe(2);
    expect(window.localStorage.getItem(ACCOUNT_STORAGE_KEY)).toBe('2');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: [1] });
    expect(history.push).not.toHaveBeenCalled();
  });

  it('switching on a detail page goes to the section list', async () => {
    history.location = { pathname: '/content/40' };
    listAccounts.mockResolvedValue(
      page([account(1, 'alpha'), account(2, 'zeta')]),
    );
    const { result } = await renderHook(() => useAccountModel());
    await expect.poll(() => result.current.currentAccountId).toBe(1);
    await act(async () => result.current.setCurrentAccount(2));
    expect(history.push).toHaveBeenCalledWith('/content');
  });

  it('has no account and no request while signed out', async () => {
    state.userId = null;
    const { result } = await renderHook(() => useAccountModel());
    expect(result.current.currentAccountId).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it('exposes a load failure for PageError', async () => {
    listAccounts.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => useAccountModel());
    await expect.poll(() => result.current.error).toBeTruthy();
    expect(result.current.loading).toBe(false);
  });
});
