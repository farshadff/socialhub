import { PlusOutlined } from '@ant-design/icons';
import {
  type ActionType,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  Button,
  Empty,
  Input,
  message,
  notification,
  Select,
  Space,
  Typography,
} from 'antd';
import React, { useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  type FeedItem,
  type FeedItemStatus,
  listFeedItems,
  listFeedSources,
  updateFeedItem,
} from '@/services/socialhub/feeds';
import { isApiError } from '@/services/socialhub/http';
import { notifyError } from '@/utils/errorText';
import FeedItemFormModal from './FeedItemFormModal';
import { bulkResultText, type FeedItemAction, feedItemActions } from './logic';
import {
  ExternalLink,
  type SelectionTabProps,
  toPageParams,
  useReloadOnChange,
} from './shared';

const DEFAULT_STATUSES: FeedItemStatus[] = ['new', 'eligible'];

const STATUS_OPTIONS: { value: FeedItemStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'eligible', label: 'Eligible' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'used', label: 'Used' },
];

const DONE_TEXT: Record<FeedItemStatus, string> = {
  eligible: 'Item marked eligible',
  ignored: 'Item ignored',
  new: 'Item updated',
  used: 'Item updated',
};

/** Explains a refused status change (E03-S01 rule 18). */
function transitionError(error: unknown) {
  if (
    isApiError(error) &&
    error.code === 'invalid_transition' &&
    error.details.content_item
  ) {
    notification.warning({
      title: 'This item is in use',
      description:
        'A content item made from it is still in progress. Cancel that item first if you want to use this one again.',
    });
    return;
  }
  notifyError(error);
}

/** Feed items tab (E03-S01). */
const FeedItemsTab: React.FC<SelectionTabProps> = ({
  account,
  refreshKey,
  onChanged,
  goToTab,
}) => {
  const actionRef = useRef<ActionType>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [statuses, setStatuses] = useState<FeedItemStatus[]>(DEFAULT_STATUSES);
  const [source, setSource] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const readOnly = account.status === 'archived';
  useReloadOnChange(actionRef, refreshKey);

  const sourcesQuery = useQuery({
    queryKey: [account.id, 'feed-sources', refreshKey],
    queryFn: () => listFeedSources({ account: account.id }),
  });

  const reload = () => {
    actionRef.current?.reload();
    onChanged();
  };

  const change = async (item: FeedItem, action: FeedItemAction) => {
    setPending((map) => ({ ...map, [item.id]: true }));
    try {
      await updateFeedItem(item.id, { status: action.to });
      message.success(DONE_TEXT[action.to]);
      reload();
    } catch (err) {
      transitionError(err);
    } finally {
      setPending(({ [item.id]: _, ...rest }) => rest);
    }
  };

  const bulk = async (to: FeedItemStatus, rows: FeedItem[]) => {
    setBulkBusy(true);
    // Rows already in the target status count as done; a move the status table does not allow
    // counts as "could not be changed" without a request.
    const already = rows.filter((row) => row.status === to).length;
    const targets = rows.filter(
      (row) =>
        row.status !== to && feedItemActions(row).some((a) => a.to === to),
    );
    const results = await Promise.allSettled(
      targets.map((row) => updateFeedItem(row.id, { status: to })),
    );
    const updated =
      already + results.filter((r) => r.status === 'fulfilled').length;
    const failed = rows.length - updated;
    setBulkBusy(false);
    setSelected([]);
    if (failed) message.warning(bulkResultText(updated, failed));
    else message.success(bulkResultText(updated, 0));
    reload();
  };

  const columns: ProColumns<FeedItem>[] = [
    {
      title: 'Title',
      dataIndex: 'title',
      render: (_, row) =>
        row.url ? (
          <ExternalLink href={row.url}>
            <ContentText>{row.title}</ContentText>
          </ExternalLink>
        ) : (
          <ContentText>{row.title}</ContentText>
        ),
    },
    {
      title: 'Source',
      dataIndex: ['source', 'name'],
      width: 180,
    },
    {
      title: 'Published',
      dataIndex: 'published_at',
      width: 170,
      render: (_, row) => <DateTime value={row.published_at} />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (_, row) => <StatusTag kind="feed_item" status={row.status} />,
    },
    {
      title: 'Content item',
      dataIndex: 'content_item',
      width: 130,
      render: (_, row) =>
        row.content_item ? (
          <Link to={`/content/${row.content_item.id}`}>Open item</Link>
        ) : (
          '—'
        ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: 'Actions',
            valueType: 'option' as const,
            width: 190,
            render: (_: React.ReactNode, row: FeedItem) =>
              feedItemActions(row).map((action) => (
                <Button
                  key={action.key}
                  type="link"
                  size="small"
                  loading={pending[row.id]}
                  onClick={() => change(row, action)}
                >
                  {action.label}
                </Button>
              )),
          },
        ]),
  ];

  if (error) {
    return (
      <ProCard>
        <PageError error={error} onRetry={() => setError(null)} />
      </ProCard>
    );
  }

  const filtered =
    source !== undefined ||
    search !== '' ||
    statuses.join() !== DEFAULT_STATUSES.join();

  return (
    <ProCard>
      <ProTable<FeedItem>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        options={false}
        params={{ statuses, source, search }}
        pagination={{ defaultPageSize: 20, showSizeChanger: false }}
        scroll={{ x: 1000 }}
        rowSelection={
          readOnly
            ? false
            : {
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys),
              }
        }
        tableAlertOptionRender={({ selectedRows, onCleanSelected }) => (
          <Space size={8}>
            <Button
              size="small"
              loading={bulkBusy}
              onClick={() => bulk('eligible', selectedRows)}
            >
              Mark eligible
            </Button>
            <Button
              size="small"
              loading={bulkBusy}
              onClick={() => bulk('ignored', selectedRows)}
            >
              Ignore
            </Button>
            <Button size="small" type="link" onClick={onCleanSelected}>
              Clear selection
            </Button>
          </Space>
        )}
        expandable={{
          rowExpandable: (row) => Boolean(row.summary),
          expandedRowRender: (row) => (
            <ContentText as="p" preserveLineBreaks>
              {row.summary}
            </ContentText>
          ),
        }}
        request={async (params) => {
          try {
            const page = await listFeedItems({
              account: account.id,
              ...toPageParams(params),
              status: statuses.length ? statuses : undefined,
              source,
              search: search || undefined,
            });
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
        locale={{
          emptyText: filtered ? (
            <Empty description="No feed items match these filters." />
          ) : (
            <Empty description="No feed items yet. Add a feed source or add an item by hand.">
              {readOnly ? null : (
                <Space>
                  <Button onClick={() => goToTab('feed-sources')}>
                    Add feed source
                  </Button>
                  <Button type="primary" onClick={() => setAddOpen(true)}>
                    Add item
                  </Button>
                </Space>
              )}
            </Empty>
          ),
        }}
        toolBarRender={() => [
          <Select<number>
            key="source"
            allowClear
            aria-label="Source"
            placeholder="All sources"
            style={{ minWidth: 180 }}
            value={source}
            onChange={(value) => setSource(value ?? undefined)}
            loading={sourcesQuery.isLoading}
            options={(sourcesQuery.data?.results ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />,
          <Select<FeedItemStatus[]>
            key="status"
            mode="multiple"
            aria-label="Status"
            placeholder="Any status"
            style={{ minWidth: 200 }}
            value={statuses}
            onChange={setStatuses}
            options={STATUS_OPTIONS}
          />,
          <Input.Search
            key="search"
            aria-label="Search titles"
            placeholder="Search titles"
            allowClear
            style={{ width: 220 }}
            onSearch={(value) => setSearch(value.trim())}
          />,
          readOnly ? null : (
            <Button
              key="add"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddOpen(true)}
            >
              Add item
            </Button>
          ),
        ]}
      />
      <Typography.Text
        type="secondary"
        style={{ display: 'block', marginTop: 8 }}
      >
        Only eligible items are considered when you rank candidates.
      </Typography.Text>
      <FeedItemFormModal
        open={addOpen}
        account={account}
        onOpenChange={setAddOpen}
        onSaved={() => reload()}
      />
    </ProCard>
  );
};

export default FeedItemsTab;
