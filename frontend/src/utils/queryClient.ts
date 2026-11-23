import { MutationCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '@/services/socialhub/http';
import { notifyError } from './errorText';

/**
 * Data-fetching convention (E00-S02 rule 25): `ProTable`'s `request` for tables, TanStack Query
 * for everything else, with query keys shaped `[accountId, resource, params]` so switching
 * account can invalidate every key that starts with the old account ID.
 */
export type MutationMeta = {
  /** Called on `409` so the page can reload the resource (rule 34). */
  onConflict?: () => void;
};

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: MutationMeta;
  }
}

/**
 * Default mutation failure handling (rule 34): a notification with the code's text and the
 * reference, unless the mutation passes its own `onError`; a `409` also calls `meta.onConflict`.
 */
export function handleMutationError(
  error: unknown,
  options: { onError?: unknown; meta?: MutationMeta },
) {
  if (isApiError(error) && error.status === 409) options.meta?.onConflict?.();
  if (options.onError) return;
  // A session that ended is already handled by the request layer's redirect.
  if (isApiError(error) && error.code === 'authentication_required') return;
  notifyError(error);
}

/** The panel's one query client, provided in `rootContainer` (src/app.tsx). */
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      handleMutationError(error, mutation.options),
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
