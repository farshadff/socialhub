import { useQueryClient } from '@tanstack/react-query';
import { useModel } from '@umijs/max';
import { useCallback } from 'react';
import {
  type Account,
  type AccountUpdate,
  updateAccount,
} from '@/services/socialhub/accounts';
import { accountKeys } from '../shared';

/**
 * `PATCH /accounts/{id}/`, then the account query is updated in place and the account model is
 * refreshed so the switcher and the top-bar connection and publishing tags follow (E00-S03).
 * Errors are thrown to the caller.
 */
export function useAccountUpdate(accountId: number) {
  const queryClient = useQueryClient();
  const { refreshAccounts } = useModel('account');
  return useCallback(
    async (body: AccountUpdate): Promise<Account> => {
      const saved = await updateAccount(accountId, body);
      queryClient.setQueryData(accountKeys.account(accountId), saved);
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      refreshAccounts();
      return saved;
    },
    [accountId, queryClient, refreshAccounts],
  );
}
