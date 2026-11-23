import {
  AlertOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import { history, Link } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  List,
  Progress,
  Row,
  Col,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useState } from 'react';
import ContentText from '@/components/ContentText';
import AccountGate from '@/components/AccountGate';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { useOverview } from '@/hooks/useOverview';
import type { AttentionItem, Overview, OverviewGoal } from '@/services/socialhub/overview';
import type { Format } from '@/services/socialhub/formats';

const PIPELINE: { label: string; statuses: readonly string[]; countStatuses?: readonly string[]; note: string; waiting?: boolean }[] = [
  { label: 'Plan & select', statuses: ['selected', 'briefed'], note: 'Selected and waiting for a brief' },
  { label: 'Create', statuses: ['scripted', 'in_production'], note: 'Scripted or in production' },
  { label: 'Check', statuses: ['in_check', 'needs_revision'], note: 'Under check or being revised' },
  { label: 'Needs you', statuses: ['in_review', 'selected', 'briefed'], countStatuses: ['in_review'], note: 'Review, brief approval and script approval', waiting: true },
  { label: 'Ready', statuses: ['approved', 'scheduled', 'publishing'], note: 'Approved or waiting to publish' },
  { label: 'Published', statuses: ['published'], note: 'Published this week' },
  { label: 'Problems', statuses: ['failed'], note: 'Failed items' },
] as const;
const PIPELINE_STATUS: Record<string, string> = {
  'Plan & select': 'selected', Create: 'in_production', Check: 'needs_revision',
  'Needs you': 'in_review', Ready: 'scheduled', Published: 'published', Problems: 'failed',
};

const BLOCKED_REASON: Record<string, string> = {
  publishing_paused: 'Waiting: publishing is off',
  connection_problem: 'Waiting: Instagram connection problem',
  daily_limit: 'Waiting: daily limit reached',
  capability_missing: 'Waiting: Instagram does not support this format',
};
const metricLabel = (value: string) => value.replaceAll('_', ' ').replace(/^\w/, (char) => char.toUpperCase());
const formatLabel = (value: Format | null) => value ? (value === 'feed_post' ? 'feed post' : value) : 'all formats';

const OverviewPage: React.FC = () => {
  return <AccountGate title="Overview"><OverviewContent /></AccountGate>;
};

const OverviewContent: React.FC = () => {
  const query = useOverview();
  const [refreshing, setRefreshing] = useState(false);
  const data = query.data;
  const refresh = async () => {
    setRefreshing(true);
    try { await query.refresh(); } finally { setRefreshing(false); }
  };
  if (query.accountId === null) return null;
  if (query.isPending) return <PageContainer title="Overview"><OverviewSkeleton /></PageContainer>;
  if (query.error || !data) return <PageContainer title="Overview"><PageError error={query.error} onRetry={() => { void query.refetch(); }} /></PageContainer>;

  return (
    <PageContainer
      title="Overview"
      content={`Your week at @${data.account.handle}`}
      extra={<Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => { void refresh(); }}>Refresh</Button>}
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}><PlanCard data={data} /></Col>
        <Col xs={24} xl={8}><FollowersCard overview={data} /></Col>
        <Col xs={24}><PipelineCard overview={data} /></Col>
        <Col xs={24} xl={14}><AttentionCard items={data.attention} count={data.attention_count} /></Col>
        <Col xs={24} xl={10}><NextPublicationsCard overview={data} /></Col>
        <Col xs={24}><SyncCard overview={data} /></Col>
      </Row>
    </PageContainer>
  );
};

const OverviewSkeleton = () => <Row gutter={[16, 16]}>{['plan', 'followers', 'pipeline', 'attention', 'publications', 'sync'].map((key) => <Col key={key} xs={24} md={12}><ProCard><Skeleton active paragraph={{ rows: 3 }} /></ProCard></Col>)}</Row>;

const PlanCard: React.FC<{ data: Overview }> = ({ data }) => {
  const plan = data.plan;
  if (!plan) return (
    <ProCard title="This week" headerBordered>
      <Empty description="No plan covers this week."><Link to="/plans?create=1"><Button type="primary">Create weekly plan</Button></Link></Empty>
    </ProCard>
  );
  const published = plan.slots.published ?? 0;
  return (
    <ProCard title="This week" headerBordered extra={<Link to={`/plans/${plan.id}`}>Open plan</Link>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Flex wrap gap={8} align="center"><Typography.Title level={5} style={{ margin: 0 }}><Link to={`/plans/${plan.id}`}>{plan.title}</Link></Typography.Title><StatusTag kind="plan" status={plan.status} /><Typography.Text type="secondary">{plan.week_start} – {plan.week_end}</Typography.Text></Flex>
        {plan.status === 'draft' ? <Alert type="info" showIcon title="This plan is a draft. Activate it to start the week." /> : null}
        {plan.objective ? <ContentText as="p">{plan.objective}</ContentText> : null}
        <div>
          <Flex justify="space-between"><Typography.Text strong>Slots</Typography.Text><Typography.Text>{published} of {plan.slots.total} published</Typography.Text></Flex>
          <Progress percent={plan.slots.total ? Math.round((published / plan.slots.total) * 100) : 0} showInfo={false} />
          <Typography.Text type="secondary">{plan.slots.published ?? 0} published · {plan.slots.scheduled ?? 0} scheduled · {plan.slots.open ?? 0} open</Typography.Text>
        </div>
        {plan.goals.length ? <Space direction="vertical" size={8} style={{ width: '100%' }}>{plan.goals.map((goal) => <GoalLine key={`${goal.metric}-${goal.format ?? 'all'}`} goal={goal} />)}</Space> : <Typography.Text type="secondary">No weekly goals yet.</Typography.Text>}
      </Space>
    </ProCard>
  );
};

const GoalLine: React.FC<{ goal: OverviewGoal }> = ({ goal }) => {
  const percent = goal.attainment === null ? 0 : Math.max(0, Math.min(100, Math.round(goal.attainment * 100)));
  return <div>
    <Flex justify="space-between" gap={8} wrap>
      <Typography.Text>{metricLabel(goal.metric)} · {formatLabel(goal.format)}</Typography.Text>
      <Typography.Text>{goal.actual === null ? 'No data yet' : `${goal.actual.toLocaleString('en-US')} of ${goal.target_value.toLocaleString('en-US')}${goal.attainment === null ? '' : ` · ${Math.round(goal.attainment * 100)}%`}`}</Typography.Text>
    </Flex>
    <Progress percent={percent} showInfo={false} status={goal.attainment !== null && goal.attainment >= 1 ? 'success' : 'normal'} />
    {goal.partial ? <Tooltip title="Some posts have no value for this metric yet"><Tag>Partial</Tag></Tooltip> : null}
  </div>;
};

const FollowersCard: React.FC<{ overview: Overview }> = ({ overview }) => (
  <ProCard title="Followers" headerBordered extra={<Link to="/analytics/account">Account analytics</Link>}>
    <Statistic title="Current" value={overview.followers.current ?? 'No data yet'} />
    <Typography.Text type="secondary">
      {overview.followers.change_7d === null ? 'No 7-day change yet' : `${overview.followers.change_7d >= 0 ? '+' : ''}${overview.followers.change_7d.toLocaleString('en-US')} in 7 d`}
    </Typography.Text>
  </ProCard>
);

const PipelineCard: React.FC<{ overview: Overview }> = ({ overview }) => {
  const count = (statuses: readonly string[]) => statuses.reduce((sum, status) => sum + (overview.items_by_status[status] ?? 0), 0);
  const planId = overview.plan?.id;
  return (
    <ProCard title="Pipeline" headerBordered>
      <Row gutter={[12, 16]}>
        {PIPELINE.map((tile) => {
          const value = count(tile.countStatuses ?? tile.statuses) + (tile.waiting ? overview.items_waiting.brief_approval + overview.items_waiting.script_approval : 0);
          const link = planId ? `/content?plan=${planId}&status=${[...tile.statuses].join(',')}` : '/content';
          const detail = tile.waiting ? `${overview.items_waiting.brief_approval} brief approvals · ${overview.items_waiting.script_approval} script approvals` : tile.note;
          return <Col key={tile.label} xs={12} sm={8} lg={6} xl={3}>
          <Tooltip title={`${tile.note}. ${detail}`}><Link to={link} aria-label={`${tile.label}: ${value}. ${detail}`}>
              <Card hoverable bodyStyle={{ padding: 12 }}><Space direction="vertical" size={8}><StatusTag kind="item" status={PIPELINE_STATUS[tile.label]} /><Statistic title={tile.label} value={value} /></Space></Card>
            </Link></Tooltip>
          </Col>;
        })}
      </Row>
    </ProCard>
  );
};

const AttentionCard: React.FC<{ items: AttentionItem[]; count: number }> = ({ items, count }) => (
  <ProCard title={`Needs attention · ${count}`} headerBordered>
    {items.length === 0 ? <Empty image={<CheckCircleOutlined />} description="Nothing needs you right now." /> : <>
      <List dataSource={items} renderItem={(item) => <AttentionRow key={item.id} item={item} />} />
      {count > items.length ? <Typography.Text type="secondary">Showing {items.length} of {count}</Typography.Text> : null}
    </>}
  </ProCard>
);

const AttentionRow: React.FC<{ item: AttentionItem }> = ({ item }) => {
  const icon = item.severity === 'high' ? <ExclamationCircleOutlined role="img" aria-label="High" /> : item.severity === 'medium' ? <AlertOutlined role="img" aria-label="Medium" /> : <ClockCircleOutlined role="img" aria-label="Low" />;
  return <List.Item actions={[item.requires_admin ? <Typography.Text key="admin" type="secondary">Ask an admin</Typography.Text> : <Button key="open" type="link" onClick={() => history.push(item.link)}>Open</Button>]}>
    <List.Item.Meta
      avatar={<Space direction="vertical" align="center"><span>{icon}</span><StatusTag kind="attention" status={item.severity} /></Space>}
      title={item.title}
      description={<Space direction="vertical" size={2}><Typography.Text type="secondary">{item.detail}</Typography.Text>{item.since ? <Tooltip title={<DateTime value={item.since} />}><Typography.Text type="secondary"><DateTime value={item.since} format="relative" /></Typography.Text></Tooltip> : null}</Space>}
    />
  </List.Item>;
};

const NextPublicationsCard: React.FC<{ overview: Overview }> = ({ overview }) => (
  <ProCard title="Next publications" headerBordered extra={<Link to="/calendar">Open calendar</Link>}>
    {overview.next_publications.length === 0 ? <Empty description="Nothing is scheduled." /> : <List dataSource={overview.next_publications} renderItem={(item) => <List.Item>
      <List.Item.Meta
        avatar={<CalendarOutlined />}
        title={<Space wrap><DateTime value={item.scheduled_at} format="relative" /><StatusTag kind="publication" status={item.status} /><Typography.Text type="secondary">{item.format === 'feed_post' ? 'Feed post' : metricLabel(item.format)}</Typography.Text></Space>}
        description={<Space direction="vertical" size={2}><Link to={`/content/${item.content_item}`}><ContentText>{item.title}</ContentText></Link>{item.blocked_reason ? <Typography.Text type="danger">{BLOCKED_REASON[item.blocked_reason] ?? `Waiting: ${item.blocked_reason.replaceAll('_', ' ')}`}</Typography.Text> : null}</Space>}
      />
    </List.Item>} />}
  </ProCard>
);

const SyncCard: React.FC<{ overview: Overview }> = ({ overview }) => {
  const { sync } = overview;
  return <ProCard title="Sync health" headerBordered>
    <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }} items={[
      { key: 'instagram', label: 'Instagram', children: <Space direction="vertical" size={2}><StatusTag kind="connection" status={sync.connection_status} /><Typography.Text type="secondary">Verified <DateTime value={sync.connection_last_verified_at} format="relative" empty="never" /></Typography.Text>{sync.connection_token_expires_at ? <Typography.Text type={sync.connection_status === 'expiring' ? 'warning' : 'secondary'}>Access expires <DateTime value={sync.connection_token_expires_at} /></Typography.Text> : null}</Space> },
      { key: 'metrics', label: 'Metrics', children: <Space direction="vertical" size={2}><DateTime value={sync.metrics_last_snapshot_at} format="relative" empty="No readings yet" />{sync.metrics_overdue ? <Typography.Text type="warning">{sync.metrics_overdue} overdue</Typography.Text> : null}</Space> },
      { key: 'followers', label: 'Followers', children: <DateTime value={sync.followers_last_snapshot_date} empty="No follower snapshot" /> },
      { key: 'feeds', label: 'Feeds', children: <DateTime value={sync.feeds_last_synced_at} format="relative" empty="No feed sources" /> },
    ]} />
  </ProCard>;
};

export default OverviewPage;
