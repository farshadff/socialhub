import { history, useModel } from '@umijs/max';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Account, listAccounts } from '@/services/socialhub/accounts';
import {
  listPathForDetail,
  pickInitialAccountId,
  readStoredAccountId,
  setRequestAccountId,
  sortByHandle,
  storeAccountId,
} from '@/utils/accountRequest';
import { queryClient } from '@/utils/queryClient';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/** What `useModel('account')` returns. Declared so the model's type doesn't depend on itself. */
export type AccountModel = {
  accounts: Account[];
  currentAccountId: number | null;
  currentAccount: Account | null;
  /** True until the first list arrives for the signed-in user, and while reloading. */
  loading: boolean;
  error: unknown;
  setCurrentAccount: (id: number) => void;
  refreshAccounts: () => Promise<void>;
};

/**
 * Account context (E00-S02 rules 17–20): the active accounts, the current one, and switching.
 * Read with `useModel('account')` or the hooks in `@/utils/accountRequest`.
 *
 * Accounts load once a user is signed in and are cleared on sign-out. Umi models render outside
 * `rootContainer`, so this uses the shared `queryClient` instance rather than `useQueryClient()`.
 */
export default function useAccountModel(): AccountModel {
  const { initialState } = useModel('@@initialState');
  const userId: number | null = initialState?.currentUser?.id ?? null;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState<number | null>(
    null,
  );
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<unknown>(null);
  const currentRef = useRef<number | null>(null);

  const applyCurrent = useCallback((id: number | null, store: boolean) => {
    currentRef.current = id;
    setCurrentAccountId(id);
    setRequestAccountId(id);
    if (store && id !== null) storeAccountId(id);
  }, []);

  const refreshAccounts = useCallback(async () => {
    setStatus('loading');
    try {
      const page = await listAccounts();
      const active = sortByHandle(
        page.results.filter((account) => account.status !== 'archived'),
      );
      setAccounts(active);
      setError(null);
      applyCurrent(
        pickInitialAccountId(
          active,
          currentRef.current ?? readStoredAccountId(),
        ),
        true,
      );
      setStatus('ready');
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, [applyCurrent]);

  useEffect(() => {
    if (userId === null) {
      setAccounts([]);
      setError(null);
      setStatus('idle');
      // Keep the stored choice so the next sign-in restores it.
      applyCurrent(null, false);
      return;
    }
    refreshAccounts();
  }, [userId, refreshAccounts, applyCurrent]);

  /**
   * Rule 20: store the new ID, invalidate every query keyed by the old account, and stay on the
   * same list page; a detail page goes to its section's list, because the record belongs to the
   * other account.
   */
  const setCurrentAccount = useCallback(
    (id: number) => {
      const old = currentRef.current;
      if (old === id) return;
      applyCurrent(id, true);
      if (old !== null) queryClient.invalidateQueries({ queryKey: [old] });
      const listPath = listPathForDetail(history.location.pathname);
      if (listPath) history.push(listPath);
    },
    [applyCurrent],
  );

  const currentAccount = useMemo(
    () => accounts.find((account) => account.id === currentAccountId) ?? null,
    [accounts, currentAccountId],
  );

  return {
    accounts,
    currentAccountId,
    currentAccount,
    loading: status === 'loading' || (userId !== null && status === 'idle'),
    error,
    setCurrentAccount,
    refreshAccounts,
  };
}
