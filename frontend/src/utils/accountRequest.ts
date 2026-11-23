import { useModel } from '@umijs/max';
import type { Account } from '@/services/socialhub/accounts';
import type { QueryParams } from '@/services/socialhub/http';

/**
 * Account scope for API calls (E00-S02 rules 17–21). The current account lives in the `account`
 * model (src/models/account.ts); this module mirrors its ID so service calls outside React can
 * scope themselves, and is the only place that builds the `account` parameter.
 */

export const ACCOUNT_STORAGE_KEY = 'socialhub.currentAccountId';

let requestAccountId: number | null = null;

/** Kept in sync by the account model; not for pages. */
export function setRequestAccountId(id: number | null) {
  requestAccountId = id;
}

export function getRequestAccountId(): number | null {
  return requestAccountId;
}

/**
 * Adds the current account to the query parameters (or body) of an account-scoped call.
 * Pages sit inside `AccountGate`, so an account is always selected when they call this.
 */
export function withAccount<T extends Record<string, unknown> = QueryParams>(
  params: T = {} as T,
): T & { account: number | null } {
  return { account: requestAccountId, ...params };
}

/** Query key convention: `[accountId, resource, params]` (rule 25). */
export function accountQueryKey(
  accountId: number | null,
  resource: string,
  params?: unknown,
) {
  return params === undefined
    ? ([accountId, resource] as const)
    : ([accountId, resource, params] as const);
}

export function readStoredAccountId(): number | null {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_STORAGE_KEY);
    const id = raw ? Number(raw) : Number.NaN;
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}

export function storeAccountId(id: number) {
  try {
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, String(id));
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
}

export function sortByHandle<T extends Pick<Account, 'handle'>>(
  accounts: T[],
): T[] {
  return [...accounts].sort((a, b) =>
    a.handle.localeCompare(b.handle, 'en', { sensitivity: 'base' }),
  );
}

/** Rule 18: the stored ID if it is still listed, else the first account by handle, else none. */
export function pickInitialAccountId(
  accounts: Pick<Account, 'id' | 'handle'>[],
  stored: number | null,
): number | null {
  if (stored !== null && accounts.some((account) => account.id === stored)) {
    return stored;
  }
  return sortByHandle(accounts)[0]?.id ?? null;
}

/** Detail routes and the list page each belongs to (rule 20). */
const DETAIL_ROUTES: [RegExp, string][] = [
  [/^\/plans\/[^/]+\/?$/, '/plans'],
  [/^\/content\/[^/]+\/?$/, '/content'],
  [/^\/review\/[^/]+\/?$/, '/review'],
  [/^\/analytics\/posts\/[^/]+\/?$/, '/analytics/posts'],
  [/^\/reports\/[^/]+\/?$/, '/reports'],
  [/^\/settings\/accounts\/[^/]+\/?$/, '/settings/accounts'],
];

/** For a detail page, the section's list page; null for any other page. */
export function listPathForDetail(pathname: string): string | null {
  return DETAIL_ROUTES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function useCurrentAccount() {
  const { currentAccount, currentAccountId, loading } = useModel('account');
  return { account: currentAccount, accountId: currentAccountId, loading };
}

export function useAccountId(): number | null {
  return useModel('account').currentAccountId;
}

export function useIsAdmin(): boolean {
  const { initialState } = useModel('@@initialState');
  return initialState?.currentUser?.access === 'admin';
}
