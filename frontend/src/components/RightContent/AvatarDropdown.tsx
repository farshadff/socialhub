import { LogoutOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { history, useModel } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Spin } from 'antd';
import React, { startTransition } from 'react';
import { logout } from '@/services/socialhub/auth';
import { queryClient } from '@/utils/queryClient';
import { LOGIN_PATH } from '@/utils/session';
import { saveNavTheme } from '@/utils/themePreference';
import HeaderDropdown from '../HeaderDropdown';

/**
 * The avatar menu (E00-S01): the Light / Dark theme choice and "Sign out". Sign out calls
 * `POST /auth/logout/`, clears initial state and cached data, and goes to sign-in.
 */
export const AvatarDropdown: React.FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const { initialState, setInitialState } = useModel('@@initialState');

  if (!initialState?.currentUser) {
    return <Spin size="small" />;
  }

  const isDarkTheme = initialState.settings?.navTheme === 'realDark';

  const menuItems: MenuProps['items'] = [
    {
      key: 'theme-mode',
      icon: isDarkTheme ? <MoonOutlined /> : <SunOutlined />,
      label: 'Theme',
      children: [
        { key: 'theme-light', label: 'Light' },
        { key: 'theme-dark', label: 'Dark' },
      ],
    },
    { type: 'divider' as const },
    { key: 'sign-out', icon: <LogoutOutlined />, label: 'Sign out' },
  ];

  const signOut = async () => {
    try {
      await logout();
    } catch {
      // The session may already be gone; signing out locally still applies.
    }
    queryClient.clear();
    startTransition(() => {
      setInitialState((state) =>
        state ? { ...state, currentUser: undefined } : state,
      );
    });
    history.replace(LOGIN_PATH);
  };

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'theme-light' || key === 'theme-dark') {
      const navTheme = key === 'theme-dark' ? 'realDark' : 'light';
      saveNavTheme(navTheme);
      setInitialState((state) =>
        state ? { ...state, settings: { ...state.settings, navTheme } } : state,
      );
      return;
    }
    if (key === 'sign-out') signOut();
  };

  return (
    <HeaderDropdown
      placement="bottomRight"
      menu={{
        selectedKeys: [isDarkTheme ? 'theme-dark' : 'theme-light'],
        onClick: onMenuClick,
        items: menuItems,
      }}
      arrow
    >
      {children}
    </HeaderDropdown>
  );
};
