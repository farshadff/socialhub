import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import { QueryClientProvider } from '@tanstack/react-query';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history, Link, useModel } from '@umijs/max';
import React, { useEffect } from 'react';
import ReviewMenuBadge from '@/components/ReviewMenuBadge';
import {
  AccountSwitcher,
  AttentionBadge,
  AvatarDropdown,
  ConnectionIndicator,
  ErrorBoundary,
  Footer,
  OfflineBanner,
  PublishingIndicator,
} from '@/components';
import Forbidden from '@/pages/exception/403';
import NotFound from '@/pages/exception/404';
import {
  type CurrentUser,
  getMe,
  toCurrentUser,
} from '@/services/socialhub/auth';
import { queryClient } from '@/utils/queryClient';
import {
  isAuthPath,
  loginPath,
  onSessionEnded,
  sessionStarted,
} from '@/utils/session';
import { getSavedNavTheme, saveNavTheme } from '@/utils/themePreference';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

export type InitialState = {
  settings: Partial<LayoutSettings>;
  currentUser?: CurrentUser;
  settingDrawerOpen: boolean;
  fetchUserInfo: () => Promise<CurrentUser | undefined>;
};

/** `GET /auth/me/` (E00-S01); undefined without a session or when the API can't be reached. */
async function fetchUserInfo(): Promise<CurrentUser | undefined> {
  try {
    const { user } = await getMe();
    sessionStarted();
    return toCurrentUser(user);
  } catch {
    return undefined;
  }
}

/** Sends a signed-out visitor to sign-in with a redirect back, except on `/user/*` pages. */
function redirectIfSignedOut(currentUser: CurrentUser | undefined) {
  const { location } = history;
  if (!currentUser && !isAuthPath(location.pathname)) {
    history.replace(loginPath(location));
  }
}

/** Session bootstrap (E00-S01): the signed-in user, or a redirect to `/user/login?redirect=…`. */
export async function getInitialState(): Promise<InitialState> {
  const currentUser = await fetchUserInfo();
  redirectIfSignedOut(currentUser);
  return {
    currentUser,
    fetchUserInfo,
    settings: {
      ...defaultSettings,
      navTheme: getSavedNavTheme(
        defaultSettings.navTheme === 'realDark' ? 'realDark' : 'light',
      ),
    } as Partial<LayoutSettings>,
    settingDrawerOpen: false,
  };
}

/** Clears the current user when the request layer reports that the session ended. */
const SessionWatcher: React.FC = () => {
  const { setInitialState } = useModel('@@initialState');
  useEffect(
    () =>
      onSessionEnded(() =>
        setInitialState((state) =>
          state ? { ...state, currentUser: undefined } : state,
        ),
      ),
    [setInitialState],
  );
  return null;
};

export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => ({
  menuItemRender: (item, dom) => {
    if (item.path) {
      const menuContent = item.path === '/review' ? <ReviewMenuBadge>{dom}</ReviewMenuBadge> : dom;
      return (
        <Link to={item.path} prefetch>
          {menuContent}
        </Link>
      );
    }
    return dom;
  },
  /** Browser tab: "{Page title} · Social Hub" (E00-S02 rule 12). */
  pageTitleRender: (_props, _defaultTitle, info) =>
    info?.pageName && info.pageName !== info.title
      ? `${info.pageName} · Social Hub`
      : 'Social Hub',
  /** Top bar: logo and name, account switcher, (space), indicators, attention, user menu. */
  headerContentRender: () => <AccountSwitcher />,
  actionsRender: () => [
    <ConnectionIndicator key="connection" />,
    <PublishingIndicator key="publishing" />,
    <AttentionBadge key="attention" />,
  ],
  avatarProps: {
    src: undefined,
    title: initialState?.currentUser?.name,
    render: (_, avatarChildren) => (
      <AvatarDropdown>{avatarChildren}</AvatarDropdown>
    ),
  },
  footerRender: () => <Footer />,
  /** A session that ended mid-use sends the user to sign-in on the next navigation. */
  onPageChange: () => redirectIfSignedOut(initialState?.currentUser),
  unAccessible: <Forbidden />,
  noFound: <NotFound />,
  ErrorBoundary,
  menuHeaderRender: undefined,
  childrenRender: (children) => (
    <>
      <SessionWatcher />
      {children}
      <SettingDrawer
        disableUrlParams
        enableDarkTheme
        collapse={initialState?.settingDrawerOpen}
        onCollapseChange={(open) => {
          setInitialState((state) =>
            state ? { ...state, settingDrawerOpen: open } : state,
          );
        }}
        settings={initialState?.settings}
        onSettingChange={(settings) => {
          saveNavTheme(settings.navTheme);
          setInitialState((state) => (state ? { ...state, settings } : state));
        }}
      />
    </>
  ),
  ...initialState?.settings,
});

export const request: RequestConfig = {
  baseURL: '',
  ...errorConfig,
};

/** One `QueryClientProvider` for the panel (E00-S02 rule 25). */
export function rootContainer(container: React.ReactNode) {
  return (
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
      <ErrorBoundary>{container}</ErrorBoundary>
    </QueryClientProvider>
  );
}
