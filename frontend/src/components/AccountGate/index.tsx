import { PageContainer } from '@ant-design/pro-components';
import { Link, useModel } from '@umijs/max';
import { Button, Empty, Skeleton } from 'antd';
import React from 'react';
import PageError from '@/components/PageError';
import { useIsAdmin } from '@/utils/accountRequest';

export type AccountGateProps = {
  /** Page title for the states shown instead of the page. */
  title: string;
  children: React.ReactNode;
};

/**
 * Wraps account-scoped pages (E00-S02 rule 22). Renders the page once an account is selected;
 * otherwise a skeleton while accounts load, `PageError` if they failed, or the
 * "No account selected" state: admins get "Add account", operators are told to ask an admin.
 */
const AccountGate: React.FC<AccountGateProps> = ({ title, children }) => {
  const { currentAccount, loading, error, refreshAccounts } =
    useModel('account');
  const isAdmin = useIsAdmin();

  if (currentAccount) return <>{children}</>;

  let body: React.ReactNode;
  if (loading) {
    body = <Skeleton active />;
  } else if (error) {
    body = <PageError error={error} onRetry={refreshAccounts} />;
  } else {
    body = (
      <Empty
        description={
          isAdmin
            ? 'Add your first Instagram account to get started.'
            : 'No Instagram account is set up yet. Ask an admin to add one.'
        }
      >
        {isAdmin ? (
          <Link to="/settings/accounts">
            <Button type="primary">Add account</Button>
          </Link>
        ) : null}
      </Empty>
    );
  }
  return <PageContainer title={title}>{body}</PageContainer>;
};

export default AccountGate;
