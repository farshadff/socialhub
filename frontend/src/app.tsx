import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { Link } from '@umijs/max';
import React from 'react';

import {
  AvatarDropdown,
  ErrorBoundary,
  Footer,
  OfflineBanner,
} from '@/components';
import { getSavedNavTheme, saveNavTheme } from '@/utils/themePreference';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

/** The local preview uses a demo identity; Social Hub authentication is not implemented yet. */
export async function getInitialState(): Promise<{
  settings: Partial<LayoutSettings>;
  currentUser: API.CurrentUser;
  settingDrawerOpen: boolean;
}> {
  return {
    currentUser: {
      name: 'Local Admin',
      userid: 'local-admin',
      access: 'admin',
    },
    settings: {
      ...defaultSettings,
      navTheme: getSavedNavTheme(
        defaultSettings.navTheme === 'realDark' ? 'realDark' : 'light',
      ),
    } as Partial<LayoutSettings>,
    settingDrawerOpen: false,
  };
}

export const layout: RunTimeLayoutConfig = ({
  initialState,
  setInitialState,
}) => ({
  menuItemRender: (item, dom) => {
    if (item.path) {
      return (
        <Link to={item.path} prefetch>
          {dom}
        </Link>
      );
    }
    return dom;
  },
  actionsRender: () => [],
  avatarProps: {
    src: initialState?.currentUser?.avatar,
    title: initialState?.currentUser?.name ?? 'Local Admin',
    render: (_, avatarChildren) => (
      <AvatarDropdown>{avatarChildren}</AvatarDropdown>
    ),
  },
  footerRender: () => <Footer />,
  ErrorBoundary,
  menuHeaderRender: undefined,
  childrenRender: (children) => (
    <>
      {children}
      <SettingDrawer
        disableUrlParams
        enableDarkTheme
        collapse={initialState?.settingDrawerOpen}
        onCollapseChange={(open) => {
          setInitialState((state) => ({ ...state, settingDrawerOpen: open }));
        }}
        settings={initialState?.settings}
        onSettingChange={(settings) => {
          saveNavTheme(settings.navTheme);
          setInitialState((state) => ({ ...state, settings }));
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

export function rootContainer(container: React.ReactNode) {
  return (
    <>
      <OfflineBanner />
      <ErrorBoundary>{container}</ErrorBoundary>
    </>
  );
}
