import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOverview, OVERVIEW_KEY } from '@/services/socialhub/overview';
import { useCurrentAccount } from '@/utils/accountRequest';

export function useOverview() {
  const { accountId } = useCurrentAccount();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: OVERVIEW_KEY(accountId),
    enabled: accountId !== null,
    queryFn: () => getOverview(accountId as number),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const refresh = async () => {
    if (accountId === null) return;
    const overview = await getOverview(accountId, true);
    queryClient.setQueryData(OVERVIEW_KEY(accountId), overview);
    return overview;
  };
  return { ...query, accountId, refresh };
}
