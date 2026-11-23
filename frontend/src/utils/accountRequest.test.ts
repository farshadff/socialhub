import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@umijs/max', () => ({ useModel: vi.fn() }));

import {
  ACCOUNT_STORAGE_KEY,
  listPathForDetail,
  pickInitialAccountId,
  readStoredAccountId,
  setRequestAccountId,
  storeAccountId,
  withAccount,
} from './accountRequest';

const accounts = [
  { id: 7, handle: 'zeta.shop' },
  { id: 3, handle: 'Alpha.cafe' },
  { id: 5, handle: 'beta.home' },
];

describe('pickInitialAccountId (rule 18)', () => {
  it('keeps the stored ID while it is still listed', () => {
    expect(pickInitialAccountId(accounts, 5)).toBe(5);
  });

  it('falls back to the first account by handle', () => {
    expect(pickInitialAccountId(accounts, 99)).toBe(3);
    expect(pickInitialAccountId(accounts, null)).toBe(3);
  });

  it('is null without accounts', () => {
    expect(pickInitialAccountId([], 5)).toBeNull();
  });
});

describe('storage', () => {
  afterEach(() => window.localStorage.removeItem(ACCOUNT_STORAGE_KEY));

  it('round-trips the current account under socialhub.currentAccountId', () => {
    storeAccountId(12);
    expect(window.localStorage.getItem('socialhub.currentAccountId')).toBe('12');
    expect(readStoredAccountId()).toBe(12);
  });

  it('ignores a value that is not an ID', () => {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, 'abc');
    expect(readStoredAccountId()).toBeNull();
  });
});

describe('withAccount (rule 21)', () => {
  it('adds the current account to the parameters', () => {
    setRequestAccountId(4);
    expect(withAccount({ status: 'open' })).toEqual({
      account: 4,
      status: 'open',
    });
    expect(withAccount()).toEqual({ account: 4 });
    setRequestAccountId(null);
  });
});

describe('listPathForDetail (rule 20)', () => {
  it.each([
    ['/plans/12', '/plans'],
    ['/content/40', '/content'],
    ['/review/9', '/review'],
    ['/analytics/posts/77', '/analytics/posts'],
    ['/reports/2', '/reports'],
    ['/settings/accounts/1', '/settings/accounts'],
  ])('%s → %s', (path, list) => {
    expect(listPathForDetail(path)).toBe(list);
  });

  it.each(['/plans', '/content', '/overview', '/analytics/account'])(
    'stays on list page %s',
    (path) => {
      expect(listPathForDetail(path)).toBeNull();
    },
  );
});
