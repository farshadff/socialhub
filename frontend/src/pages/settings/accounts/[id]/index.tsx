import { PageContainer, ProCard } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { history, Link, useParams, useSearchParams } from '@umijs/max';
import { Button, Modal, message, Result, Skeleton, Space } from 'antd';
import React, { useState } from 'react';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import TabPlaceholder from '@/components/TabPlaceholder';
import { type Account, getAccount } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import { useIsAdmin } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';
import { type AccountTab, accountKeys, isAccountTab } from '../shared';
import AutomationTab from './AutomationTab';
import BrandTab from './BrandTab';
import ProfileTab from './ProfileTab';
import { useAccountUpdate } from './useAccountUpdate';

const TABS: { key: AccountTab; tab: string }[] = [
  { key: 'profile', tab: 'Profile' },
  { key: 'brand', tab: 'Brand' },
  { key: 'connection', tab: 'Connection' },
  { key: 'automation', tab: 'Automation' },
];

export const NOT_FOUND_TEXT = "This account doesn't exist.";

const ArchiveButton: React.FC<{ account: Account }> = ({ account }) => {
  const save = useAccountUpdate(account.id);
  const [busy, setBusy] = useState(false);
  const archived = account.status === 'archived';
  const handle = `@${account.handle}`;

  const run = async () => {
    setBusy(true);
    try {
      await save({ status: archived ? 'active' : 'archived' });
      message.success(archived ? 'Account restored' : 'Account archived');
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const onClick = () =>
    Modal.confirm(
      archived
        ? {
            title: `Restore ${handle}?`,
            content:
              'The account returns to the account switcher. Publishing stays off until an admin turns it on.',
            okText: 'Restore account',
            onOk: run,
          }
        : {
            title: `Archive ${handle}?`,
            content:
              'Publishing is switched off and the account is hidden from the account switcher. Its plans and content are kept.',
            okText: 'Archive account',
            okButtonProps: { danger: true },
            onOk: run,
          },
    );

  return (
    <Button danger={!archived} loading={busy} onClick={onClick}>
      {archived ? 'Restore account' : 'Archive account'}
    </Button>
  );
};

/** Settings → Accounts → one account (E00-S03 FE2): header, `?tab=` tabs. */
const AccountPage: React.FC = () => {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: AccountTab = isAccountTab(requested) ? requested : 'profile';
  const isAdmin = useIsAdmin();

  const query = useQuery({
    queryKey: accountKeys.account(id),
    queryFn: () => getAccount(id),
    enabled: validId,
  });

  const notFound =
    !validId || (isApiError(query.error) && query.error.status === 404);

  if (notFound) {
    return (
      <PageContainer title="Account">
        <ProCard>
          <Result
            status="404"
            title={NOT_FOUND_TEXT}
            extra={
              <Link to="/settings/accounts">
                <Button type="primary">Back to accounts</Button>
              </Link>
            }
          />
        </ProCard>
      </PageContainer>
    );
  }
  if (query.isError) {
    return (
      <PageContainer title="Account">
        <PageError error={query.error} onRetry={() => query.refetch()} />
      </PageContainer>
    );
  }
  if (query.isPending) {
    return (
      <PageContainer title="Account">
        <ProCard>
          <Skeleton active paragraph={{ rows: 8 }} />
        </ProCard>
      </PageContainer>
    );
  }

  const account = query.data;
  let body: React.ReactNode;
  if (tab === 'brand') body = <BrandTab account={account} />;
  else if (tab === 'automation') body = <AutomationTab account={account} />;
  else if (tab === 'connection') {
    body = (
      <ProCard>
        <TabPlaceholder text="Connecting the account to Instagram arrives with E00-S04." />
      </ProCard>
    );
  } else body = <ProfileTab account={account} />;

  return (
    <PageContainer
      title={`@${account.handle}`}
      subTitle={account.display_name}
      onBack={() => history.push('/settings/accounts')}
      tags={
        <Space size={4} wrap>
          <StatusTag kind="connection" status={account.connection_status} />
          <StatusTag
            kind="publishing"
            status={account.publishing_enabled ? 'on' : 'off'}
          />
          {account.status === 'archived' ? (
            <StatusTag kind="account" status="archived" />
          ) : null}
        </Space>
      }
      extra={isAdmin ? [<ArchiveButton key="archive" account={account} />] : []}
      tabList={TABS}
      tabActiveKey={tab}
      onTabChange={(key) =>
        history.push(`/settings/accounts/${account.id}?tab=${key}`)
      }
    >
      {/* Keyed by account and tab so each form starts from the stored values. */}
      <React.Fragment key={`${account.id}-${tab}`}>{body}</React.Fragment>
    </PageContainer>
  );
};

export default AccountPage;
