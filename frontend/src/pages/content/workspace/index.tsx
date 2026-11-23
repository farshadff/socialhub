import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  history,
  Link,
  useModel,
  useParams,
  useSearchParams,
} from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  message,
  Result,
  Skeleton,
  Space,
  Steps,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import TabPlaceholder from '@/components/TabPlaceholder';
import useFormats from '@/pages/content/shared/useFormats';
import {
  type ContentItemDetail,
  getContentItem,
} from '@/services/socialhub/content';
import { isApiError } from '@/services/socialhub/http';
import { isActive } from '@/services/socialhub/jobs';
import { KIND_LABEL, scoreText, subScoresText } from '../../selection/logic';
import CancelItemModal from '../CancelItemModal';
import {
  defaultTab,
  STEP_TITLES,
  stepFor,
  TAB_PLACEHOLDER,
  WORKSPACE_TABS,
  type WorkspaceTab,
} from '../logic';
import { ItemFormatTag } from '../parts';
import FormatRoleControls from './header/FormatRoleControls';
import BriefTab from './tabs/BriefTab';
import HistoryTab from './tabs/HistoryTab';
import ProductionTab from './tabs/ProductionTab';
import ScriptTab from './tabs/ScriptTab';
import ChecksTab from './tabs/ChecksTab';
import PublishingTab from './tabs/PublishingTab';
import PerformanceTab from './tabs/PerformanceTab';

const TAB_LABEL: Record<WorkspaceTab, string> = {
  brief: 'Brief',
  script: 'Script',
  production: 'Production',
  checks: 'Checks',
  publishing: 'Publishing',
  performance: 'Performance',
  history: 'History',
};

/** Keeps a failing tab from taking the header and the other tabs down with it. */
class TabBoundary extends React.Component<
  { children: React.ReactNode; onRetry: () => void },
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="This tab could not be shown."
          subTitle="The rest of the item still works. Reload the tab to try again."
          extra={
            <Button
              type="primary"
              onClick={() => {
                this.setState({ error: null });
                this.props.onRetry();
              }}
            >
              Reload tab
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}

/** Candidate behind the item: kind, rank, scores, rationale, summary and sources. */
const SourceCard: React.FC<{ item: ContentItemDetail; onHide: () => void }> = ({
  item,
  onHide,
}) => {
  const candidate = item.candidate;
  return (
    <Card
      size="small"
      title="Source"
      extra={
        <Tooltip title="Hide source">
          <Button
            type="text"
            size="small"
            icon={<MenuUnfoldOutlined />}
            aria-label="Hide source"
            onClick={onHide}
          />
        </Tooltip>
      }
    >
      {candidate ? (
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Space size={4} wrap>
            <Tag>{KIND_LABEL[candidate.kind] ?? candidate.kind}</Tag>
            {candidate.rank ? (
              <Typography.Text type="secondary">
                Rank {candidate.rank}
              </Typography.Text>
            ) : null}
          </Space>
          <div>
            <Typography.Text strong>
              {scoreText(candidate.total_score)}
            </Typography.Text>{' '}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              total score
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {subScoresText({
                evidence_score: candidate.evidence_score ?? null,
                goal_fit_score: candidate.goal_fit_score ?? null,
                freshness_score: candidate.freshness_score ?? null,
              })}
            </Typography.Text>
          </div>
          {candidate.rationale ? (
            <ContentText as="p">{candidate.rationale}</ContentText>
          ) : null}
          {candidate.summary ? (
            <ContentText as="p" preserveLineBreaks>
              {candidate.summary}
            </ContentText>
          ) : null}
          {candidate.sources?.length ? (
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {candidate.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ContentText>{source.title || source.url}</ContentText>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </Space>
      ) : (
        <Typography.Text type="secondary">
          This item was not created from a ranked candidate.
        </Typography.Text>
      )}
    </Card>
  );
};

const StepIndicator: React.FC<{ item: ContentItemDetail }> = ({ item }) => {
  const step = stepFor(item.status);
  const warning =
    item.status === 'in_review' || item.status === 'needs_revision';
  return (
    <Steps
      size="small"
      current={step.current}
      status={item.status === 'cancelled' ? 'wait' : step.status}
      items={STEP_TITLES.map((title, index) => ({
        title,
        // Waiting for a person shows the warning colour on the current step (Ant Design has no
        // warning step status, so the step's title carries it).
        ...(warning && index === step.current
          ? { title: <Typography.Text type="warning">{title}</Typography.Text> }
          : {}),
      }))}
    />
  );
};

const SOURCE_STORAGE_KEY = 'socialhub.workspace.sourceHidden';

const ItemWorkspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token } = theme.useToken();
  const { currentAccountId, accounts, setCurrentAccount } = useModel('account');
  const { roleLabel } = useFormats();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sourceHidden, setSourceHidden] = useState(() => {
    try {
      return window.localStorage.getItem(SOURCE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [tabNonce, setTabNonce] = useState(0);
  // Each increment opens the header's "Format and role" modal (E04-S02).
  const [formatRequest, setFormatRequest] = useState(0);
  const switched = useRef(false);

  const itemQuery = useQuery({
    queryKey: ['content-item', id],
    enabled: Boolean(id && /^\d+$/.test(id)),
    queryFn: () => getContentItem(id as string),
    retry: (count, error) =>
      !(isApiError(error) && error.status === 404) && count < 2,
    // Every 3 seconds while a job runs, so progress and status follow without a reload.
    refetchInterval: (query) => {
      const job = query.state.data?.active_job;
      return job && isActive(job.status) ? 3000 : false;
    },
  });
  const item = itemQuery.data;
  const reload = () => itemQuery.refetch();

  // Follow the item's account: switch the account switcher once (E03-S04 Panel).
  useEffect(() => {
    if (!item || switched.current) return;
    if (currentAccountId !== null && item.account !== currentAccountId) {
      const target = accounts.find(
        (account: { id: number }) => account.id === item.account,
      );
      if (target) {
        switched.current = true;
        setCurrentAccount(item.account);
        message.info(`Switched to @${target.handle}`);
      }
    }
  }, [item?.account, currentAccountId, accounts.length]);

  const toggleSource = (hidden: boolean) => {
    setSourceHidden(hidden);
    try {
      window.localStorage.setItem(SOURCE_STORAGE_KEY, hidden ? '1' : '0');
    } catch {
      // The choice then lasts for this page only.
    }
  };

  if (
    !id ||
    !/^\d+$/.test(id) ||
    (isApiError(itemQuery.error) && itemQuery.error.status === 404)
  ) {
    return (
      <PageContainer title="Content item">
        <Result
          status="404"
          title="We couldn't find this item"
          subTitle="It may have been removed, or it belongs to an account you can't see."
          extra={
            <Button type="primary" onClick={() => history.push('/content')}>
              Back to content
            </Button>
          }
        />
      </PageContainer>
    );
  }
  if (itemQuery.error && !item) {
    return (
      <PageContainer title="Content item">
        <PageError error={itemQuery.error} onRetry={reload} />
      </PageContainer>
    );
  }
  if (!item) {
    return (
      <PageContainer title={<Skeleton.Input active size="small" />}>
        <Skeleton active paragraph={{ rows: 2 }} />
        <Skeleton
          active
          paragraph={{ rows: 6 }}
          style={{ marginTop: token.marginLG }}
        />
      </PageContainer>
    );
  }

  const tabParam = searchParams.get('tab') as WorkspaceTab | null;
  const tab: WorkspaceTab =
    tabParam && WORKSPACE_TABS.includes(tabParam)
      ? tabParam
      : defaultTab(item.status);
  const switchTab = (next: WorkspaceTab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const jobRunning = item.active_job && isActive(item.active_job.status);
  const canCancel = item.allowed_actions.includes('cancel');

  const tabBody = (key: WorkspaceTab): React.ReactNode => {
    const props = {
      item,
      reload,
      switchTab,
      openFormatModal: () => setFormatRequest((n) => n + 1),
    };
    switch (key) {
      case 'brief':
        return <BriefTab {...props} />;
      case 'script':
        return <ScriptTab {...props} />;
      case 'production':
        return <ProductionTab {...props} />;
      case 'checks':
        return <ChecksTab {...props} />;
      case 'publishing':
        return <PublishingTab {...props} />;
      case 'performance':
        return <PerformanceTab {...props} />;
      case 'history':
        return <HistoryTab {...props} />;
      default:
        return <TabPlaceholder text={TAB_PLACEHOLDER[key]} />;
    }
  };

  return (
    <PageContainer
      title={<ContentText>{item.title}</ContentText>}
      onBack={() => history.push('/content')}
      tags={
        <Space size={4} wrap>
          <StatusTag kind="item" status={item.status} />
          <ItemFormatTag format={item.format} />
          <Tag>{roleLabel(item.role)}</Tag>
          <Typography.Text type="secondary">
            {item.slot ? (
              <DateTime value={item.slot.scheduled_at} />
            ) : (
              'No slot'
            )}
          </Typography.Text>
        </Space>
      }
      extra={[
        <FormatRoleControls
          key="format"
          item={item}
          reload={reload}
          openRequest={formatRequest}
        />,
        item.open_review_task ? (
          <Link key="review" to={`/review/${item.open_review_task.id}`}>
            <Button>Open review task</Button>
          </Link>
        ) : null,
        canCancel ? (
          <Button key="cancel" danger onClick={() => setCancelOpen(true)}>
            Cancel item
          </Button>
        ) : null,
      ]}
    >
      <Space
        orientation="vertical"
        size={token.margin}
        style={{ width: '100%' }}
      >
        {jobRunning ? (
          <JobProgress
            job={item.active_job}
            title="Working on this item"
            onDone={reload}
            onFailed={reload}
          />
        ) : null}
        {item.hold_reason && !jobRunning ? (
          <Alert type="warning" showIcon title={item.hold_reason} />
        ) : null}
        {item.status === 'cancelled' ? (
          <Alert
            type="error"
            showIcon
            title={`Cancelled: ${item.cancelled_reason || 'no reason given'}`}
          />
        ) : null}
        <Card size="small">
          <StepIndicator item={item} />
        </Card>
        <div
          style={{
            display: 'flex',
            gap: token.margin,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <Tabs
              activeKey={tab}
              onChange={(next) => switchTab(next as WorkspaceTab)}
              tabBarExtraContent={
                sourceHidden ? (
                  <Button
                    type="text"
                    icon={<MenuFoldOutlined />}
                    onClick={() => toggleSource(false)}
                  >
                    Show source
                  </Button>
                ) : null
              }
              items={WORKSPACE_TABS.map((key) => ({
                key,
                label: TAB_LABEL[key],
                children:
                  key === tab ? (
                    <TabBoundary
                      key={`${key}:${tabNonce}`}
                      onRetry={() => setTabNonce((n) => n + 1)}
                    >
                      {tabBody(key)}
                    </TabBoundary>
                  ) : null,
              }))}
            />
          </div>
          {sourceHidden ? null : (
            <aside style={{ width: 320, flex: 'none' }} aria-label="Source">
              <SourceCard item={item} onHide={() => toggleSource(true)} />
            </aside>
          )}
        </div>
      </Space>
      <CancelItemModal
        item={item}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          setCancelOpen(false);
          reload();
          switchTab('history');
        }}
      />
    </PageContainer>
  );
};

export default ItemWorkspace;
