import {
  PageContainer,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { history, Link, useSearchParams } from '@umijs/max';
import {
  Button,
  Empty,
  Input,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Typography,
} from 'antd';
import React, { useEffect, useState } from 'react';
import AccountGate from '@/components/AccountGate';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import { lookupStatus, sentenceCase } from '@/components/StatusTag';
import useFormats from '@/pages/content/shared/useFormats';
import type { Account } from '@/services/socialhub/accounts';
import {
  type ContentItemSummary,
  ITEM_STATUSES,
  listContentItems,
  type ItemStatus as Status,
} from '@/services/socialhub/content';
import {
  FORMATS,
  type Format,
  ROLES,
  type Role,
} from '@/services/socialhub/formats';
import { isApiError } from '@/services/socialhub/http';
import { listPlans } from '@/services/socialhub/plans';
import { getCurrentPlan } from '@/services/socialhub/selection';
import { useCurrentAccount } from '@/utils/accountRequest';
import { shortDate } from '../selection/logic';
import CancelItemModal from './CancelItemModal';
import ContentBoard from './ContentBoard';
import WriteMissingBriefsButton from './components/WriteMissingBriefsButton';
import {
  BOARD_LIMIT,
  type ContentFilters,
  type ContentView,
  filtersToParams,
  filtersToRequest,
  NOT_CANCELLABLE,
  parseFilters,
} from './logic';
import { hasRunningJob, ItemFormatTag, ItemStatus, Thumbnail } from './parts';

const VIEW_STORAGE_KEY = 'socialhub.content.view';

function readView(): ContentView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'board'
      ? 'board'
      : 'list';
  } catch {
    return 'list';
  }
}

function storeView(view: ContentView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage can be unavailable; the choice then lasts for this page only.
  }
}

const statusLabel = (status: Status) =>
  lookupStatus('item', status)?.label ?? sentenceCase(status);

const ContentPipeline: React.FC<{ account: Account }> = ({ account }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseFilters(searchParams);
  const [view, setView] = useState<ContentView>(readView);
  const [page, setPage] = useState({ current: 1, pageSize: 20 });
  const [searchText, setSearchText] = useState(filters.search);
  const [cancelling, setCancelling] = useState<ContentItemSummary | null>(null);
  const { formatLabel, roleLabel, modeLabel } = useFormats();

  const setFilters = (changes: Partial<ContentFilters>) => {
    setSearchParams(filtersToParams({ ...filters, ...changes }, searchParams), {
      replace: true,
    });
    setPage((current) => ({ ...current, current: 1 }));
  };

  const plansQuery = useQuery({
    queryKey: [account.id, 'plans', 'all'],
    queryFn: () => listPlans({ account: account.id, ordering: '-week_start' }),
  });
  const currentPlanQuery = useQuery({
    queryKey: [account.id, 'plans', 'current'],
    queryFn: async () => {
      try {
        return await getCurrentPlan(account.id);
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  });

  // Default plan: the current plan, otherwise all plans (E03-S04 Panel).
  useEffect(() => {
    if (filters.plan !== null || currentPlanQuery.isLoading) return;
    setFilters({ plan: currentPlanQuery.data?.id ?? 'all' });
  }, [filters.plan, currentPlanQuery.isLoading]);

  const ready = filters.plan !== null;
  const request = filtersToRequest(account.id, filters);
  const itemsQuery = useQuery({
    queryKey: [
      account.id,
      'content-items',
      view,
      request,
      view === 'list' ? page : null,
    ],
    enabled: ready,
    queryFn: () =>
      listContentItems({
        ...request,
        ordering: 'slot_time',
        ...(view === 'board'
          ? { page: 1, page_size: BOARD_LIMIT }
          : { page: page.current, page_size: page.pageSize }),
      }),
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: true,
    // Refresh every 10 seconds while any visible item has a running job.
    refetchInterval: (query) =>
      hasRunningJob(query.state.data?.results ?? []) ? 10_000 : false,
  });

  const items = itemsQuery.data?.results ?? [];
  const total = itemsQuery.data?.count ?? 0;
  const filtered =
    filters.status.length > 0 ||
    filters.format.length > 0 ||
    filters.role !== null ||
    filters.needsAttention ||
    filters.search !== '';

  const columns: ProColumns<ContentItemSummary>[] = [
    {
      title: '',
      key: 'thumbnail',
      width: 64,
      render: (_, row) => <Thumbnail item={row} />,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Link to={`/content/${row.id}`}>
            <ContentText>{row.title}</ContentText>
          </Link>
          {row.hold_reason ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.hold_reason}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: 'Format',
      dataIndex: 'format',
      width: 150,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <ItemFormatTag format={row.format} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {modeLabel(row.production_mode)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      width: 110,
      render: (_, row) => roleLabel(row.role),
    },
    {
      title: 'Slot',
      dataIndex: 'slot',
      width: 170,
      render: (_, row) =>
        row.slot ? (
          <DateTime value={row.slot.scheduled_at} />
        ) : (
          <Typography.Text type="secondary">No slot</Typography.Text>
        ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 220,
      render: (_, row) => <ItemStatus item={row} />,
    },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      width: 130,
      render: (_, row) => <DateTime value={row.updated_at} format="relative" />,
    },
    {
      title: 'Actions',
      valueType: 'option',
      width: 130,
      render: (_, row) => [
        <Link key="open" to={`/content/${row.id}`}>
          Open
        </Link>,
        NOT_CANCELLABLE.includes(row.status) ||
        account.status === 'archived' ? null : (
          <Button
            key="cancel"
            type="link"
            size="small"
            danger
            onClick={() => setCancelling(row)}
          >
            Cancel
          </Button>
        ),
      ],
    },
  ];

  const planOptions = [
    { value: 'all', label: 'All plans' },
    ...(plansQuery.data?.results ?? []).map((plan) => ({
      value: String(plan.id),
      label: plan.title || `Week of ${shortDate(plan.week_start)}`,
    })),
  ];

  const toolbar = (
    <Space wrap size={8}>
      <Select<string>
        aria-label="Plan"
        style={{ minWidth: 200 }}
        loading={plansQuery.isLoading}
        value={filters.plan === null ? undefined : String(filters.plan)}
        onChange={(value) =>
          setFilters({ plan: value === 'all' ? 'all' : Number(value) })
        }
        options={planOptions}
      />
      <Select<Status[]>
        mode="multiple"
        aria-label="Status"
        placeholder="Any status"
        style={{ minWidth: 200 }}
        maxTagCount="responsive"
        value={filters.status}
        onChange={(status) => setFilters({ status })}
        options={ITEM_STATUSES.map((status) => ({
          value: status,
          label: statusLabel(status),
        }))}
      />
      <Select<Format[]>
        mode="multiple"
        aria-label="Format"
        placeholder="Any format"
        style={{ minWidth: 160 }}
        value={filters.format}
        onChange={(format) => setFilters({ format })}
        options={FORMATS.map((format) => ({
          value: format,
          label: formatLabel(format),
        }))}
      />
      <Select<Role | 'none'>
        allowClear
        aria-label="Role"
        placeholder="Any role"
        style={{ minWidth: 140 }}
        value={filters.role ?? undefined}
        onChange={(role) => setFilters({ role: role ?? null })}
        options={[
          ...ROLES.map((role) => ({ value: role, label: roleLabel(role) })),
          { value: 'none' as const, label: 'Not set' },
        ]}
      />
      <Space size={6}>
        <Switch
          size="small"
          id="needs-attention"
          checked={filters.needsAttention}
          onChange={(needsAttention) => setFilters({ needsAttention })}
        />
        <label htmlFor="needs-attention">Needs attention</label>
      </Space>
      <Input.Search
        aria-label="Search titles"
        placeholder="Search titles"
        allowClear
        style={{ width: 200 }}
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        onSearch={(search) => setFilters({ search })}
      />
    </Space>
  );

  let body: React.ReactNode;
  if (itemsQuery.error && !itemsQuery.data) {
    body = (
      <PageError
        error={itemsQuery.error}
        onRetry={() => itemsQuery.refetch()}
      />
    );
  } else if (!ready || (itemsQuery.isLoading && !itemsQuery.data)) {
    body = <Skeleton active />;
  } else if (total === 0 && !filtered) {
    body = (
      <Empty description="No content yet. Confirm a selection to create this week's items.">
        <Button
          type="primary"
          onClick={() =>
            history.push(
              typeof filters.plan === 'number'
                ? `/selection?plan=${filters.plan}&tab=proposal`
                : '/selection',
            )
          }
        >
          Go to selection
        </Button>
      </Empty>
    );
  } else if (view === 'board') {
    body =
      total === 0 ? (
        <Empty description="No items match these filters." />
      ) : (
        <ContentBoard
          items={items}
          total={total}
          statusFilter={filters.status}
        />
      );
  } else {
    body = (
      <ProTable<ContentItemSummary>
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={itemsQuery.isFetching && !itemsQuery.isRefetching}
        search={false}
        options={false}
        toolBarRender={false}
        scroll={{ x: 1100 }}
        pagination={{
          current: page.current,
          pageSize: page.pageSize,
          total,
          showSizeChanger: false,
          onChange: (current, pageSize) => setPage({ current, pageSize }),
        }}
        locale={{
          emptyText: <Empty description="No items match these filters." />,
        }}
      />
    );
  }

  return (
    <PageContainer
      title="Content"
      content="Every piece of content and where it stands."
      extra={[
        <WriteMissingBriefsButton
          key="briefs"
          planId={typeof filters.plan === 'number' ? filters.plan : null}
          onDone={() => itemsQuery.refetch()}
        />,
        <Segmented<ContentView>
          key="view"
          aria-label="View"
          value={view}
          onChange={(next) => {
            setView(next);
            storeView(next);
          }}
          options={[
            { value: 'list', label: 'List' },
            { value: 'board', label: 'Board' },
          ]}
        />,
      ]}
    >
      <ProCard>
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
          {toolbar}
          {body}
        </Space>
      </ProCard>
      <CancelItemModal
        item={cancelling}
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        onCancelled={() => {
          setCancelling(null);
          itemsQuery.refetch();
        }}
      />
    </PageContainer>
  );
};

const ContentPage: React.FC = () => {
  const { account } = useCurrentAccount();
  return (
    <AccountGate title="Content">
      {account ? <ContentPipeline key={account.id} account={account} /> : null}
    </AccountGate>
  );
};

export default ContentPage;
