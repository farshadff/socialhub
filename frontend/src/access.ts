import type { CurrentUser } from '@/services/socialhub/auth';

/**
 * Two roles (E00-S01): `admin` can do everything; `operator` everything except admin-only actions.
 * `canAdmin` guards admin routes such as `/settings/system` and hides admin-only actions.
 * @see https://umijs.org/docs/max/access#access
 */
export default function access(
  initialState: { currentUser?: Pick<CurrentUser, 'access'> } | undefined,
) {
  const { currentUser } = initialState ?? {};
  return {
    canAdmin: currentUser?.access === 'admin',
  };
}
