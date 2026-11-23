import { PlusOutlined } from '@ant-design/icons';
import {
  type ActionType,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { Dayjs } from 'dayjs';
import React, { useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime, { formatDateTime } from '@/components/DateTime';
import PageError from '@/components/PageError';
import {
  getTopic,
  listRuns,
  listSignals,
  listSources,
  type SignalKind,
  type TrendSignal,
} from '@/services/socialhub/research';
import { formatMetrics, KIND_LABEL } from './constants';
import SignalFormModal from './SignalFormModal';
import {
  ExternalLink,
  KindTag,
  type TabProps,
  toPageParams,
  useReloadOnChange,
} from './shared';

const TopicTitles: React.FC<{ accountId: number; ids: number[] }> = ({
  accountId,
  ids,
}) => {
  const results = useQueries({
    queries: ids.slice(0, 10).map((id) => ({
      queryKey: [accountId, 'research-topic', id],
      queryFn: () => getTopic(id),
    })),
  });
  return (
    <div>
      {results.map((result, index) =>
        result.data ? (
          <div key={result.data.id}>
            <ContentText>{result.data.title}</ContentText>
          </div>
        ) : (
          <Spin key={ids[index]} size="small" />
        ),
      )}
    </div>
  );
};

/** Signals tab: every finding with its original link (E02-S05). */
const SignalsTab: React.FC<TabProps> = ({
  account,
  refreshKey,
  readOnly,
  onOpenTopic,
}) => {
  const actionRef = useRef<ActionType>(undefined);
  const [kinds, setKinds] = useState<SignalKind[]>([]);
  const [source, setSource] = useState<number | undefined>();
  const [run, setRun] = useState<number | undefined>();
  const [unassigned, setUnassigned] = useState(false);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [q, setQ] = useState('');
  const [searchText, setSearchText] = useState('');
  const [onlyId, setOnlyId] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [addOpen, setAddOpen] = useState(false);
  useReloadOnChange(actionRef, refreshKey);

  const sourcesQuery = useQuery({
    queryKey: [account.id, 'research-sources', 'options', refreshKey],
    queryFn: () => listSources({ account: account.id, page_size: 100 }),
  });
  const runsQuery = useQuery({
    queryKey: [account.id, 'research-runs', 'options', refreshKey],
    queryFn: () => listRuns({ account: account.id, page_size: 20 }),
  });

  const filtered =
    kinds.length > 0 ||
    !!source ||
    !!run ||
    unassigned ||
    !!range ||
    q !== '' ||
    onlyId !== null;

  const columns: ProColumns<TrendSignal>[] = [
    {
      title: 'Signal',
      dataIndex: 'title',
      width: '34%',
      render: (_, row) => (
        <div>
          {row.url ? (
            <ExternalLink href={row.url}>
              <ContentText strong>{row.title}</ContentText>
            </ExternalLink>
          ) : (
            <ContentText strong>{row.title}</ContentText>
          )}
          {row.excerpt ? (
            <Typography.Text type="secondary">
              <ContentText ellipsis={2}>{row.excerpt}</ContentText>
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Kind',
      dataIndex: 'kind',
      width: 130,
      render: (_, row) => <KindTag kind={row.kind} />,
    },
    {
      title: 'Source',
      dataIndex: 'source',
      render: (_, row) =>
        row.source ? <ContentText>{row.source.label}</ContentText> : '—',
    },
    {
      title: 'Author',
      dataIndex: 'author',
      render: (_, row) =>
        row.author ? <ContentText>{row.author}</ContentText> : '—',
    },
    {
      title: 'Published',
      dataIndex: 'published_at',
      width: 150,
      render: (_, row) => <DateTime value={row.published_at} empty="No date" />,
    },
    {
      title: 'Captured',
      dataIndex: 'captured_at',
      width: 150,
      render: (_, row) => <DateTime value={row.captured_at} />,
    },
    {
      title: 'Metrics',
      dataIndex: 'metrics',
      render: (_, row) => formatMetrics(row.metrics) ?? '—',
    },
    {
      title: 'Topics',
      dataIndex: 'topic_ids',
      width: 90,
      render: (_, row) =>
        row.topic_ids.length ? (
          <Tooltip
            title={<TopicTitles accountId={account.id} ids={row.topic_ids} />}
          >
            <Button
              type="link"
              size="small"
              onClick={() => onOpenTopic(row.topic_ids[0])}
            >
              {row.topic_ids.length}
            </Button>
          </Tooltip>
        ) : (
          '0'
        ),
    },
  ];

  if (error) {
    return (
      <ProCard>
        <PageError error={error} onRetry={() => setError(null)} />
      </ProCard>
    );
  }

  return (
    <ProCard>
      {onlyId !== null ? (
        <Tag
          closable
          onClose={() => setOnlyId(null)}
          style={{ marginBottom: 12 }}
        >
          Showing signal #{onlyId}
        </Tag>
      ) : null}
      <ProTable<TrendSignal>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        options={false}
        params={{ kinds, source, run, unassigned, range, q, onlyId }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        request={async (params) => {
          try {
            const page = await listSignals({
              account: account.id,
              ...toPageParams(params),
              ...(onlyId !== null
                ? { id: onlyId }
                : {
                    kind: kinds.length ? kinds : undefined,
                    source,
                    run,
                    unassigned: unassigned || undefined,
                    captured_after: range?.[0]?.startOf('day').toISOString(),
                    captured_before: range?.[1]?.endOf('day').toISOString(),
                    q: q || undefined,
                  }),
            });
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
        locale={{
          emptyText: filtered ? (
            <Empty description="No signals match these filters." />
          ) : (
            <Empty description="No signals yet. Signals are the posts and articles research finds. Run research or add one by hand.">
              {readOnly ? null : (
                <Button type="primary" onClick={() => setAddOpen(true)}>
                  Add signal
                </Button>
              )}
            </Empty>
          ),
        }}
        toolBarRender={() => [
          <Select<SignalKind[]>
            key="kind"
            mode="multiple"
            aria-label="Kind"
            placeholder="Kind"
            style={{ minWidth: 150 }}
            value={kinds}
            onChange={setKinds}
            options={(Object.keys(KIND_LABEL) as SignalKind[]).map((value) => ({
              value,
              label: KIND_LABEL[value],
            }))}
          />,
          <Select<number>
            key="source"
            aria-label="Source"
            placeholder="Source"
            allowClear
            style={{ width: 170 }}
            value={source}
            onChange={setSource}
            loading={sourcesQuery.isLoading}
            options={(sourcesQuery.data?.results ?? []).map((item) => ({
              value: item.id,
              label: item.label,
            }))}
          />,
          <Select<number>
            key="run"
            aria-label="Run"
            placeholder="Run"
            allowClear
            style={{ width: 170 }}
            value={run}
            onChange={setRun}
            loading={runsQuery.isLoading}
            options={(runsQuery.data?.results ?? []).map((item) => ({
              value: item.id,
              label: formatDateTime(item.started_at, account.timezone),
            }))}
          />,
          <Checkbox
            key="unassigned"
            checked={unassigned}
            onChange={(event) => setUnassigned(event.target.checked)}
          >
            Not in any topic
          </Checkbox>,
          <DatePicker.RangePicker
            key="range"
            aria-label="Captured between"
            placeholder={['Captured from', 'Captured to']}
            value={range}
            onChange={(value) =>
              setRange(value as [Dayjs | null, Dayjs | null] | null)
            }
          />,
          <Input.Search
            key="search"
            aria-label="Search signals"
            placeholder="Search signals"
            allowClear
            style={{ width: 180 }}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onSearch={(value) => setQ(value.trim())}
          />,
          readOnly ? null : (
            <Button
              key="add"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddOpen(true)}
            >
              Add signal
            </Button>
          ),
        ]}
      />
      <SignalFormModal
        open={addOpen}
        account={account}
        onOpenChange={setAddOpen}
        onCreated={() => actionRef.current?.reload()}
        onShowExisting={(id) => setOnlyId(id)}
      />
    </ProCard>
  );
};

export default SignalsTab;
