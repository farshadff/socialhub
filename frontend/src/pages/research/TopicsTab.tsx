import { PlusOutlined } from '@ant-design/icons';
import {
  type ActionType,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Empty,
  Input,
  Progress,
  Select,
  Slider,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import React, { useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  listRuns,
  listTopics,
  type TopicOrigin,
  type TopicStatus,
  type TrendTopic,
} from '@/services/socialhub/research';
import { EVIDENCE_LABEL, TOPIC_STATUS_LABEL, topicActions } from './constants';
import type { PlanChoice } from './index';
import {
  FormatTags,
  type TabProps,
  toPageParams,
  useReloadOnChange,
} from './shared';
import TopicFormModal from './TopicFormModal';
import { changeTopicStatus } from './topicStatus';

const DEFAULT_STATUSES: TopicStatus[] = ['new', 'shortlisted'];

export type TopicsTabProps = TabProps & {
  plan: PlanChoice | null;
  onRunResearch?: () => void;
};

export const EvidenceCell: React.FC<{ topic: TrendTopic }> = ({ topic }) => {
  const breakdown = topic.evidence_breakdown;
  const tip = (
    <div>
      {(Object.keys(EVIDENCE_LABEL) as (keyof typeof EVIDENCE_LABEL)[]).map(
        (key) => (
          <div key={key}>
            {EVIDENCE_LABEL[key]}: {breakdown?.[key] ?? 0}
          </div>
        ),
      )}
    </div>
  );
  return (
    <Tooltip title={tip}>
      <span style={{ display: 'inline-block', minWidth: 96 }}>
        <Typography.Text strong>{topic.evidence_score}</Typography.Text>
        <Progress
          percent={topic.evidence_score}
          size="small"
          showInfo={false}
        />
      </span>
    </Tooltip>
  );
};

/** Topics tab: triage what research found (E02-S05). */
const TopicsTab: React.FC<TopicsTabProps> = ({
  account,
  refreshKey,
  readOnly,
  runActive,
  plans,
  plan,
  onOpenTopic,
  onRunResearch,
}) => {
  const actionRef = useRef<ActionType>(undefined);
  const [statuses, setStatuses] = useState<TopicStatus[]>(DEFAULT_STATUSES);
  const [origin, setOrigin] = useState<TopicOrigin | 'all'>('all');
  const [minEvidence, setMinEvidence] = useState(0);
  const [q, setQ] = useState('');
  const [searchText, setSearchText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<Record<number, TopicStatus>>({});
  useReloadOnChange(actionRef, refreshKey);

  const runsQuery = useQuery({
    queryKey: [account.id, 'research-runs', 'count', refreshKey],
    queryFn: () => listRuns({ account: account.id, page_size: 1 }),
  });
  const hasRuns = (runsQuery.data?.count ?? 0) > 0;

  const filtersChanged =
    statuses.join() !== DEFAULT_STATUSES.join() ||
    origin !== 'all' ||
    minEvidence > 0 ||
    q !== '';

  const clearFilters = () => {
    setStatuses(DEFAULT_STATUSES);
    setOrigin('all');
    setMinEvidence(0);
    setQ('');
    setSearchText('');
  };

  const reload = () => actionRef.current?.reload();

  const act = async (topic: TrendTopic, actionKey: string) => {
    const action = topicActions(topic.status).find((a) => a.key === actionKey);
    if (!action) return;
    setPending((map) => ({ ...map, [topic.id]: action.to }));
    await changeTopicStatus(topic, action, reload);
    setPending(({ [topic.id]: _, ...rest }) => rest);
  };

  const columns: ProColumns<TrendTopic>[] = [
    {
      title: 'Topic',
      dataIndex: 'title',
      width: '36%',
      render: (_, row) => (
        <div>
          <ContentText strong>{row.title}</ContentText>
          {row.summary ? (
            <Typography.Text type="secondary">
              <ContentText ellipsis={2}>{row.summary}</ContentText>
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: 'Evidence',
      dataIndex: 'evidence_score',
      width: 120,
      render: (_, row) => <EvidenceCell topic={row} />,
    },
    {
      title: 'Signals',
      dataIndex: 'signal_count',
      width: 100,
      render: (_, row) =>
        `${row.signal_count} ${row.signal_count === 1 ? 'signal' : 'signals'}`,
    },
    {
      title: 'Formats',
      dataIndex: 'suggested_formats',
      render: (_, row) => <FormatTags formats={row.suggested_formats} />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (_, row) => (
        <StatusTag kind="topic" status={pending[row.id] ?? row.status} />
      ),
    },
    {
      title: 'Origin',
      dataIndex: 'origin',
      width: 80,
      render: (_, row) => (row.origin === 'ai' ? 'AI' : 'Manual'),
    },
    {
      title: 'Found',
      dataIndex: 'created_at',
      width: 160,
      render: (_, row) => <DateTime value={row.created_at} />,
    },
    {
      title: 'Actions',
      valueType: 'option',
      width: 220,
      render: (_, row) => [
        ...(readOnly || row.id in pending
          ? []
          : topicActions(row.status).map((action) => (
              <Button
                key={action.key}
                type="link"
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  act(row, action.key);
                }}
              >
                {action.label}
              </Button>
            ))),
        <Button
          key="view"
          type="link"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTopic(row.id);
          }}
        >
          View
        </Button>,
      ],
    },
  ];

  if (error) {
    return (
      <ProCard>
        <PageError error={error} onRetry={() => setError(null)} />
      </ProCard>
    );
  }

  const emptyText =
    !hasRuns && !filtersChanged ? (
      <Empty description="No topics yet. Run research to find what your audience is paying attention to.">
        {readOnly ? null : (
          <Space>
            {onRunResearch ? (
              <Button type="primary" onClick={onRunResearch}>
                Run research
              </Button>
            ) : null}
            <Button onClick={() => setAddOpen(true)}>Add topic</Button>
          </Space>
        )}
      </Empty>
    ) : (
      <Empty description="No topics match these filters.">
        {filtersChanged ? (
          <Button onClick={clearFilters}>Clear filters</Button>
        ) : null}
      </Empty>
    );

  return (
    <ProCard>
      {runActive ? (
        <Alert
          type="info"
          showIcon
          title="Research is running. Topics you have not shortlisted may be replaced when it finishes."
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <ProTable<TrendTopic>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        options={false}
        params={{ statuses, origin, minEvidence, q, plan }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        onRow={(row) => ({
          onClick: () => onOpenTopic(row.id),
          style: { cursor: 'pointer' },
        })}
        request={async (params) => {
          try {
            const page = await listTopics({
              account: account.id,
              ...toPageParams(params),
              plan: plan ?? undefined,
              status: statuses.length ? statuses : undefined,
              origin: origin === 'all' ? undefined : origin,
              min_evidence: minEvidence > 0 ? minEvidence : undefined,
              q: q || undefined,
              ordering: '-evidence_score',
            });
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
        locale={{ emptyText }}
        toolBarRender={() => [
          <Select<TopicStatus[]>
            key="status"
            mode="multiple"
            aria-label="Status"
            placeholder="Status"
            style={{ minWidth: 220 }}
            value={statuses}
            onChange={setStatuses}
            options={(Object.keys(TOPIC_STATUS_LABEL) as TopicStatus[]).map(
              (value) => ({
                value,
                label: TOPIC_STATUS_LABEL[value],
              }),
            )}
          />,
          <Select<TopicOrigin | 'all'>
            key="origin"
            aria-label="Origin"
            style={{ width: 120 }}
            value={origin}
            onChange={setOrigin}
            options={[
              { value: 'all', label: 'Any origin' },
              { value: 'ai', label: 'AI' },
              { value: 'manual', label: 'Manual' },
            ]}
          />,
          <Space key="evidence" size={8}>
            <Typography.Text id="min-evidence-label">
              Minimum evidence
            </Typography.Text>
            <Slider
              aria-labelledby="min-evidence-label"
              style={{ width: 120 }}
              min={0}
              max={100}
              value={minEvidence}
              onChange={setMinEvidence}
            />
          </Space>,
          <Input.Search
            key="search"
            aria-label="Search topics"
            placeholder="Search topics"
            allowClear
            style={{ width: 200 }}
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
              Add topic
            </Button>
          ),
        ]}
      />
      <TopicFormModal
        open={addOpen}
        account={account}
        plans={plans}
        defaultPlan={plan}
        onOpenChange={setAddOpen}
        onCreated={(topic) => {
          reload();
          onOpenTopic(topic.id);
        }}
      />
    </ProCard>
  );
};

export default TopicsTab;
