import { useModel } from '@umijs/max';
import { Select, Space, Typography } from 'antd';
import React from 'react';

/** The switcher's width from E00-S02 rule 19. */
const WIDTH = 220;

/**
 * Top-bar account switcher (E00-S02 rules 19–20): active accounts by handle, searchable by handle
 * and display name. It shows even with one account so the context is visible, and is disabled
 * with "No accounts" when there are none. Switching is done by the `account` model.
 */
const AccountSwitcher: React.FC = () => {
  const { accounts, currentAccountId, setCurrentAccount, loading } =
    useModel('account');
  const empty = !loading && accounts.length === 0;

  return (
    <Select
      aria-label="Instagram account"
      style={{ width: WIDTH }}
      loading={loading}
      disabled={empty}
      placeholder={empty ? 'No accounts' : 'Choose an account'}
      value={currentAccountId ?? undefined}
      onChange={(id: number) => setCurrentAccount(id)}
      showSearch={{
        filterOption: (input, option) =>
          String(option?.search ?? '')
            .toLowerCase()
            .includes(input.trim().replace(/^@/, '').toLowerCase()),
      }}
      options={accounts.map((account) => ({
        value: account.id,
        search: `${account.handle} ${account.display_name}`,
        label: (
          <Space size={4}>
            <span>@{account.handle}</span>
            <Typography.Text type="secondary">
              {account.display_name}
            </Typography.Text>
          </Space>
        ),
      }))}
    />
  );
};

export default AccountSwitcher;
