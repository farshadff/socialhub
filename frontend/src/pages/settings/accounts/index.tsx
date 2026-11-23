import { PlusOutlined } from '@ant-design/icons';
import {
  type ActionType,
  PageContainer,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import { Button, Empty } from 'antd';
import React, { useRef, useState } from 'react';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  type Account,
  type AccountStatus,
  searchAccounts,
} from '@/services/socialhub/accounts';
import { useIsAdmin } from '@/utils/accountRequest';
import AddAccountModal from './AddAccountModal';
import { LANGUAGE_LABEL } from './shared';

type StatusFilter = AccountStatus | 'all';

type Params = {
  current?: number;
  pageSize?: number;
  search?: string;
  status?: StatusFilter;
};

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

const EMPTY_TEXT =
  'No Instagram accounts yet. Add the first account your team manages.';

/** Settings → Accounts (E00-S03 Panel). */
const AccountsPage: React.FC = () => {
  const isAdmin = useIsAdmin();
  const actionRef = useRef<ActionType>(null);
  const [error, setError] = useState<unknown>(null);

  const addButton = (
    <AddAccountModal
      trigger={
        <Button type="primary" icon={<PlusOutlined />}>
          Add account
        </Button>
      }
    />
  );

  const columns: ProColumns<Account>[] = [
    {
      title: 'Search',
      dataIndex: 'search',
      hideInTable: true,
      fieldProps: { placeholder: 'Handle or display name' },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      hideInTable: true,
      valueType: 'select',
      initialValue: 'active',
      fieldProps: { options: STATUS_FILTER_OPTIONS, allowClear: false },
    },
    {
      title: 'Handle',
      dataIndex: 'handle',
      search: false,
      render: (_, row) => (
        <Link to={`/settings/accounts/${row.id}`}>@{row.handle}</Link>
      ),
    },
    {
      title: 'Display name',
      dataIndex: 'display_name',
      search: false,
    },
    {
      title: 'Language',
      dataIndex: 'content_language',
      search: false,
      render: (_, row) =>
        LANGUAGE_LABEL[row.content_language] ?? row.content_language,
    },
    { title: 'Timezone', dataIndex: 'timezone', search: false },
    {
      title: 'Connection',
      dataIndex: 'connection_status',
      search: false,
      render: (_, row) => (
        <StatusTag kind="connection" status={row.connection_status} />
      ),
    },
    {
      title: 'Publishing',
      dataIndex: 'publishing_enabled',
      search: false,
      render: (_, row) => (
        <StatusTag
          kind="publishing"
          status={row.publishing_enabled ? 'on' : 'off'}
        />
      ),
    },
    {
      title: 'Status',
      key: 'account_status',
      dataIndex: 'status',
      search: false,
      render: (_, row) => <StatusTag kind="account" status={row.status} />,
    },
  ];

  return (
    <PageContainer title="Accounts" extra={isAdmin ? [addButton] : []}>
      {error ? (
        <PageError
          error={error}
          onRetry={() => {
            setError(null);
            actionRef.current?.reload();
          }}
        />
      ) : null}
      <ProTable<Account, Params>
        style={error ? { display: 'none' } : undefined}
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        options={false}
        scroll={{ x: 1000 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        locale={{
          emptyText: (
            <Empty description={EMPTY_TEXT}>{isAdmin ? addButton : null}</Empty>
          ),
        }}
        request={async ({ current, pageSize, search, status }) => {
          try {
            const page = await searchAccounts({
              page: current,
              page_size: pageSize,
              search: search?.trim() || undefined,
              status: status && status !== 'all' ? status : undefined,
            });
            setError(null);
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
      />
    </PageContainer>
  );
};

export default AccountsPage;
