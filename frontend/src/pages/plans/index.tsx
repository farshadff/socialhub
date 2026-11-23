import {
  type ActionType,
  PageContainer,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from '@umijs/max';
import { Button, Empty, message, Popconfirm, Space } from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import DateTime from '@/components/DateTime';
import StatusTag from '@/components/StatusTag';
import type { Account } from '@/services/socialhub/accounts';
import {
  deletePlan,
  listPlanRows,
  type PlanRow,
  type PlanStatus,
} from '@/services/socialhub/plans';
import { useCurrentAccount } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';
import PlanWeekModal from './components/PlanWeekModal';
import { weekRange } from './shared';

const STATUS_FILTERS: { text: string; value: PlanStatus }[] = [
  { text: 'Draft', value: 'draft' },
  { text: 'Active', value: 'active' },
  { text: 'Closed', value: 'closed' },
];

const PlanList: React.FC<{ account: Account }> = ({ account }) => {
  const actionRef = useRef<ActionType>(null);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(searchParams.get('create') === '1');
  const [copying, setCopying] = useState<PlanRow | null>(null);

  // A different account means a different list.
  useEffect(() => {
    actionRef.current?.reloadAndRest?.();
  }, [account.id]);

  const closeCreate = (open: boolean) => {
    setCreating(open);
    if (!open && searchParams.get('create')) {
      searchParams.delete('create');
      setSearchParams(searchParams, { replace: true });
    }
  };

  const remove = async (plan: PlanRow) => {
    try {
      await deletePlan(plan.id);
      message.success('Draft plan deleted');
      queryClient.invalidateQueries({ queryKey: [account.id, 'plans'] });
      actionRef.current?.reload();
    } catch (error) {
      notifyError(error);
      actionRef.current?.reload();
    }
  };

  const columns: ProColumns<PlanRow>[] = [
    {
      title: 'Week',
      dataIndex: 'week_start',
      render: (_, plan) => weekRange(plan.week_start, plan.week_end),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      render: (_, plan) => <Link to={`/plans/${plan.id}`}>{plan.title}</Link>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      filters: STATUS_FILTERS,
      render: (_, plan) => <StatusTag kind="plan" status={plan.status} />,
    },
    {
      title: 'Slots',
      key: 'slots',
      render: (_, plan) =>
        `${plan.slot_summary.filled} / ${plan.slot_summary.total} filled`,
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      render: (_, plan) => <DateTime value={plan.updated_at} />,
    },
    {
      title: 'Actions',
      key: 'actions',
      valueType: 'option',
      render: (_, plan) => (
        <Space size="small">
          <Link to={`/plans/${plan.id}`}>Open</Link>
          <Button type="link" size="small" onClick={() => setCopying(plan)}>
            Duplicate
          </Button>
          {plan.status === 'draft' && (
            <Popconfirm
              title="Delete this draft plan and its slots?"
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => remove(plan)}
            >
              <Button type="link" size="small" danger>
                Delete
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      title="Weekly plan"
      content="One plan per week: who the week speaks to, its goals and its posting slots."
      extra={
        <Button type="primary" onClick={() => setCreating(true)}>
          New plan
        </Button>
      }
    >
      <ProTable<PlanRow>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        options={false}
        pagination={{ defaultPageSize: 20, showSizeChanger: false }}
        scroll={{ x: 900 }}
        request={async (params, _sort, filter) => {
          const status = (filter.status as PlanStatus[] | null) ?? undefined;
          const page = await listPlanRows({
            account: account.id,
            status,
            ordering: '-week_start',
            page: params.current,
            page_size: params.pageSize,
          });
          return { data: page.results, total: page.count, success: true };
        }}
        locale={{
          emptyText: (
            <Empty description="No plans yet. A plan sets the audience, goals and slots for one week.">
              <Button type="primary" onClick={() => setCreating(true)}>
                New plan
              </Button>
            </Empty>
          ),
        }}
      />
      <PlanWeekModal account={account} open={creating} onOpenChange={closeCreate} />
      <PlanWeekModal
        account={account}
        open={copying !== null}
        source={copying}
        onOpenChange={(open) => !open && setCopying(null)}
      />
    </PageContainer>
  );
};

const PlansPage: React.FC = () => {
  const { account } = useCurrentAccount();
  return (
    <AccountGate title="Weekly plan">
      {account && <PlanList key={account.id} account={account} />}
    </AccountGate>
  );
};

export default PlansPage;
