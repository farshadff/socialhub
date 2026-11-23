import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import {
  type ActionType,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import {
  Button,
  Empty,
  Modal,
  message,
  notification,
  Space,
  Switch,
  Tooltip,
  Typography,
} from 'antd';
import React, { useRef, useState } from 'react';
import DateTime from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  deleteFeedSource,
  type FeedSource,
  type FeedSourceKind,
  listFeedSources,
  syncFeedSource,
  updateFeedSource,
} from '@/services/socialhub/feeds';
import { isApiError } from '@/services/socialhub/http';
import type { JobSummary } from '@/services/socialhub/jobs';
import { jobErrorText, notifyError } from '@/utils/errorText';
import FeedSourceFormModal from './FeedSourceFormModal';
import { feedErrorText, syncResultText } from './logic';
import { type SelectionTabProps, useReloadOnChange } from './shared';

const KIND_TEXT: Record<FeedSourceKind, string> = {
  rss: 'RSS',
  json_api: 'JSON endpoint',
  manual: 'Manual',
};

/** Last sync: time plus OK, Empty or Error with the reason in a tooltip. */
export const LastSync: React.FC<{ source: FeedSource }> = ({ source }) => {
  if (!source.last_synced_at && !source.last_status) {
    return <Typography.Text type="secondary">Never</Typography.Text>;
  }
  const reason = feedErrorText(source.last_status);
  const tag = source.last_status ? (
    <StatusTag kind="feed_source" status={source.last_status} />
  ) : null;
  return (
    <Space size={4} wrap>
      <DateTime value={source.last_synced_at} empty="Never" />
      {tag && reason ? (
        <Tooltip title={reason}>
          <Button
            type="text"
            size="small"
            aria-label={`Sync failed: ${reason}`}
            style={{ padding: 0, height: 'auto' }}
          >
            {tag}
          </Button>
        </Tooltip>
      ) : (
        tag
      )}
    </Space>
  );
};

const total = (counts: FeedSource['item_counts']) =>
  Object.values(counts ?? {}).reduce((sum, n) => sum + (n ?? 0), 0);

/** Feed sources tab (E03-S01). */
const FeedSourcesTab: React.FC<SelectionTabProps> = ({
  account,
  refreshKey,
  onChanged,
}) => {
  const actionRef = useRef<ActionType>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<FeedSource | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [switching, setSwitching] = useState<Record<number, boolean>>({});
  /** Sync jobs the panel follows, by source ID. */
  const [syncJobs, setSyncJobs] = useState<Record<number, JobSummary>>({});
  const readOnly = account.status === 'archived';
  useReloadOnChange(actionRef, refreshKey);

  const reload = () => actionRef.current?.reload();

  const endSync = (sourceId: number) => {
    setSyncJobs(({ [sourceId]: _, ...rest }) => rest);
    reload();
    onChanged();
  };

  const startSync = async (source: FeedSource) => {
    const response = await syncFeedSource(source.id);
    setSyncJobs((map) => ({ ...map, [source.id]: response.job }));
    return response;
  };

  const toggleActive = async (source: FeedSource, next: boolean) => {
    setSwitching((map) => ({ ...map, [source.id]: next }));
    try {
      await updateFeedSource(source.id, { active: next });
      message.success(
        next ? `${source.name} turned on` : `${source.name} turned off`,
      );
      reload();
    } catch (err) {
      notifyError(err);
    } finally {
      setSwitching(({ [source.id]: _, ...rest }) => rest);
    }
  };

  const confirmDelete = (source: FeedSource) => {
    const count = total(source.item_counts);
    Modal.confirm({
      title: `Delete ${source.name} and its ${count} item${count === 1 ? '' : 's'}?`,
      content:
        'Items already selected into content are not affected. This cannot be undone.',
      okText: 'Delete source',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await deleteFeedSource(source.id);
          message.success('Source deleted');
          reload();
          onChanged();
        } catch (err) {
          if (isApiError(err) && err.code === 'state_conflict') {
            notification.warning({
              title:
                'This source has items used by candidates. Turn it off instead.',
            });
          } else {
            notifyError(err);
          }
        }
      },
    });
  };

  const columns: ProColumns<FeedSource>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (_, row) => <Typography.Text strong>{row.name}</Typography.Text>,
    },
    {
      title: 'Kind',
      dataIndex: 'kind',
      width: 130,
      render: (_, row) => KIND_TEXT[row.kind],
    },
    {
      title: 'Link',
      dataIndex: 'url',
      width: 260,
      render: (_, row) =>
        row.url ? (
          <Typography.Text
            style={{ maxWidth: 240 }}
            ellipsis={{ tooltip: row.url }}
            copyable={{
              text: row.url,
              icon: <CopyOutlined aria-label="Copy link" />,
            }}
          >
            {row.url}
          </Typography.Text>
        ) : (
          '—'
        ),
    },
    {
      title: 'Active',
      dataIndex: 'active',
      width: 90,
      render: (_, row) =>
        row.kind === 'manual' ? (
          '—'
        ) : (
          <Switch
            size="small"
            aria-label={`Active: ${row.name}`}
            checked={switching[row.id] ?? row.active}
            disabled={readOnly || row.id in switching}
            onChange={(next) => toggleActive(row, next)}
          />
        ),
    },
    {
      title: 'Last sync',
      dataIndex: 'last_synced_at',
      render: (_, row) =>
        row.kind === 'manual' ? '—' : <LastSync source={row} />,
    },
    {
      title: 'Items (eligible / total)',
      dataIndex: 'item_counts',
      width: 120,
      render: (_, row) =>
        `${(row.item_counts?.eligible ?? 0).toLocaleString('en-US')} / ${total(row.item_counts).toLocaleString('en-US')}`,
    },
    ...(readOnly
      ? []
      : [
          {
            title: 'Actions',
            valueType: 'option' as const,
            width: 260,
            render: (_: React.ReactNode, row: FeedSource) => {
              if (row.kind === 'manual') return [];
              const running = row.id in syncJobs;
              const busy = (node: React.ReactNode, key: string) =>
                running ? (
                  <Tooltip key={key} title="A sync is running">
                    <span>{node}</span>
                  </Tooltip>
                ) : (
                  <React.Fragment key={key}>{node}</React.Fragment>
                );
              return [
                <JobButton
                  key="sync"
                  size="small"
                  start={() => startSync(row)}
                  activeJob={syncJobs[row.id] ?? null}
                  onStarted={(job) =>
                    setSyncJobs((map) => ({ ...map, [row.id]: job }))
                  }
                  successMessage={(job) => syncResultText(job.result)}
                  failureText={(job) =>
                    feedErrorText(`error:${job.error_detail ?? ''}`) ??
                    jobErrorText(job)
                  }
                  onDone={() => endSync(row.id)}
                  onFailed={() => endSync(row.id)}
                  runningReason="A sync is running"
                >
                  Sync now
                </JobButton>,
                busy(
                  <Button
                    type="link"
                    size="small"
                    disabled={running}
                    onClick={() => {
                      setEditing(row);
                      setModalOpen(true);
                    }}
                  >
                    Edit
                  </Button>,
                  'edit',
                ),
                busy(
                  <Button
                    type="link"
                    size="small"
                    danger
                    disabled={running}
                    onClick={() => confirmDelete(row)}
                  >
                    Delete
                  </Button>,
                  'delete',
                ),
              ];
            },
          },
        ]),
  ];

  if (error) {
    return (
      <ProCard>
        <PageError
          error={error}
          onRetry={() => {
            setError(null);
          }}
        />
      </ProCard>
    );
  }

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  return (
    <ProCard>
      <ProTable<FeedSource>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        options={false}
        pagination={false}
        scroll={{ x: 1000 }}
        request={async () => {
          try {
            const page = await listFeedSources({ account: account.id });
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
        locale={{
          emptyText: (
            <Empty description="No feed sources yet. Add your blog, catalogue or news feed so its items can compete for slots.">
              {readOnly ? null : (
                <Button type="primary" onClick={openAdd}>
                  Add source
                </Button>
              )}
            </Empty>
          ),
        }}
        toolBarRender={() =>
          readOnly
            ? []
            : [
                <Button
                  key="add"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openAdd}
                >
                  Add source
                </Button>,
              ]
        }
      />
      <FeedSourceFormModal
        open={modalOpen}
        account={account}
        source={editing}
        onOpenChange={setModalOpen}
        onSaved={async (source, created) => {
          reload();
          onChanged();
          // A new source syncs at once, and the row shows its progress (E03-S01 Panel).
          if (created && source.kind !== 'manual') {
            try {
              await startSync(source);
            } catch (err) {
              notifyError(err, 'The first sync could not start');
            }
          }
        }}
      />
    </ProCard>
  );
};

export default FeedSourcesTab;
