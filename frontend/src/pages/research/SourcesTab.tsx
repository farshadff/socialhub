import { PlusOutlined } from '@ant-design/icons';
import {
  type ActionType,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import {
  Button,
  Empty,
  message,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import React, { useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import { isApiError } from '@/services/socialhub/http';
import {
  deleteSource,
  listSources,
  type ResearchSource,
  type SourceKind,
  updateSource,
} from '@/services/socialhub/research';
import { notifyError } from '@/utils/errorText';
import { limitReachedText } from './constants';
import SourceFormModal from './SourceFormModal';
import {
  ExternalLink,
  KindTag,
  SourceResultTag,
  type TabProps,
  toPageParams,
  useReloadOnChange,
} from './shared';

type ActiveFilter = 'all' | 'active' | 'inactive';

/** Sources tab: the account's research watchlist (E02-S01). */
const SourcesTab: React.FC<TabProps> = ({
  account,
  refreshKey,
  readOnly,
  runActive,
}) => {
  const actionRef = useRef<ActionType>(undefined);
  const [kinds, setKinds] = useState<SourceKind[]>([]);
  const [active, setActive] = useState<ActiveFilter>('all');
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<ResearchSource | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  useReloadOnChange(actionRef, refreshKey);

  const openAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const toggleActive = async (source: ResearchSource, next: boolean) => {
    setOverrides((map) => ({ ...map, [source.id]: next }));
    try {
      await updateSource(source.id, { active: next });
      await actionRef.current?.reload();
    } catch (err) {
      if (
        isApiError(err) &&
        err.fields.some(
          (f) => f.path === 'active' && f.code === 'limit_reached',
        )
      ) {
        message.error(limitReachedText(source.kind));
      } else {
        notifyError(err);
      }
    } finally {
      setOverrides(({ [source.id]: _, ...rest }) => rest);
    }
  };

  const remove = async (source: ResearchSource) => {
    try {
      await deleteSource(source.id);
      message.success('Source deleted');
      actionRef.current?.reload();
    } catch (err) {
      notifyError(err);
    }
  };

  const columns: ProColumns<ResearchSource>[] = [
    {
      title: 'Kind',
      dataIndex: 'kind',
      width: 130,
      render: (_, row) => <KindTag kind={row.kind} />,
    },
    {
      title: 'Value',
      dataIndex: 'value',
      ellipsis: true,
      render: (_, row) =>
        row.kind === 'rss' ? (
          <ExternalLink href={row.value}>
            <ContentText>{row.value}</ContentText>
          </ExternalLink>
        ) : (
          <ContentText>{row.value}</ContentText>
        ),
    },
    {
      title: 'Label',
      dataIndex: 'label',
      render: (_, row) => <ContentText>{row.label}</ContentText>,
    },
    {
      title: 'Active',
      dataIndex: 'active',
      width: 90,
      render: (_, row) => (
        <Switch
          size="small"
          aria-label={`Active: ${row.label}`}
          checked={overrides[row.id] ?? row.active}
          disabled={readOnly || row.id in overrides}
          onChange={(next) => toggleActive(row, next)}
        />
      ),
    },
    {
      title: 'Last run',
      dataIndex: 'last_run_at',
      render: (_, row) => <DateTime value={row.last_run_at} empty="Never" />,
    },
    {
      title: 'Last result',
      dataIndex: 'last_status',
      render: (_, row) => (
        <Space size={4} wrap>
          <SourceResultTag status={row.last_status} />
          {row.available ? null : (
            <Tooltip title="The AI provider is not configured.">
              <Tag color="warning" tabIndex={0}>
                Not available
              </Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    ...(readOnly
      ? []
      : [
          {
            title: 'Actions',
            valueType: 'option' as const,
            width: 140,
            render: (_: React.ReactNode, row: ResearchSource) => [
              <Button
                key="edit"
                type="link"
                size="small"
                onClick={() => {
                  setEditing(row);
                  setModalOpen(true);
                }}
              >
                Edit
              </Button>,
              runActive ? (
                <Tooltip
                  key="delete"
                  title="A research run is using the sources."
                >
                  <Button type="link" size="small" danger disabled>
                    Delete
                  </Button>
                </Tooltip>
              ) : (
                <Popconfirm
                  key="delete"
                  title="Delete this source? Signals already collected from it are kept."
                  okText="Delete"
                  cancelText="Cancel"
                  onConfirm={() => remove(row)}
                >
                  <Button type="link" size="small" danger>
                    Delete
                  </Button>
                </Popconfirm>
              ),
            ],
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

  const filtered = kinds.length > 0 || active !== 'all';

  return (
    <ProCard>
      <ProTable<ResearchSource>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        options={false}
        params={{ kinds, active }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        request={async (params) => {
          try {
            const page = await listSources({
              account: account.id,
              ...toPageParams(params),
              kind: kinds.length ? kinds : undefined,
              active: active === 'all' ? undefined : active === 'active',
            });
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
        locale={{
          emptyText: filtered ? (
            <Empty description="No sources match these filters." />
          ) : (
            <Empty description="No research sources yet. Add the searches and feeds you want to watch.">
              {readOnly ? null : (
                <Button type="primary" onClick={openAdd}>
                  Add source
                </Button>
              )}
            </Empty>
          ),
        }}
        toolBarRender={() => [
          <Select<SourceKind[]>
            key="kind"
            mode="multiple"
            aria-label="Kind"
            placeholder="Kind"
            style={{ minWidth: 160 }}
            value={kinds}
            onChange={setKinds}
            options={[
              { value: 'web_search', label: 'Web search' },
              { value: 'rss', label: 'RSS feed' },
            ]}
          />,
          <Select<ActiveFilter>
            key="active"
            aria-label="Active"
            style={{ width: 130 }}
            value={active}
            onChange={setActive}
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />,
          readOnly ? null : (
            <Button
              key="add"
              type="primary"
              icon={<PlusOutlined />}
              onClick={openAdd}
            >
              Add source
            </Button>
          ),
        ]}
      />
      <SourceFormModal
        key={editing?.id ?? 'new'}
        open={modalOpen}
        account={account}
        source={editing}
        onOpenChange={setModalOpen}
        onSaved={() => actionRef.current?.reload()}
      />
    </ProCard>
  );
};

export default SourcesTab;
