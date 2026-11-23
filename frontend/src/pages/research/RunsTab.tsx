import {
  type ActionType,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Empty, Skeleton, Table, Tooltip } from 'antd';
import React, { useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  getRun,
  listRuns,
  type ResearchRun,
} from '@/services/socialhub/research';
import { formatDuration, planLabel, runFailureText } from './constants';
import {
  KindTag,
  SourceResultTag,
  type TabProps,
  toPageParams,
  useReloadOnChange,
} from './shared';

const RunSources: React.FC<{ accountId: number; run: ResearchRun }> = ({
  accountId,
  run,
}) => {
  const query = useQuery({
    queryKey: [accountId, 'research-run', run.id, run.status],
    queryFn: () => getRun(run.id),
  });
  if (query.isLoading) return <Skeleton active paragraph={{ rows: 2 }} />;
  if (query.error || !query.data) {
    return <PageError error={query.error} onRetry={() => query.refetch()} />;
  }
  const detail = query.data;
  return (
    <div>
      {detail.status === 'failed' ? (
        <Alert
          type="error"
          showIcon
          title={runFailureText(detail.job?.error_code)}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Table
        rowKey="source_id"
        size="small"
        pagination={false}
        dataSource={detail.sources}
        locale={{ emptyText: 'No sources were visited in this run.' }}
        columns={[
          {
            title: 'Kind',
            dataIndex: 'kind',
            render: (_, row) => (row.kind ? <KindTag kind={row.kind} /> : '—'),
          },
          {
            title: 'Source',
            dataIndex: 'label',
            render: (_, row) =>
              row.label ? (
                <ContentText>{row.label}</ContentText>
              ) : (
                'Deleted source'
              ),
          },
          { title: 'New signals', dataIndex: 'signals' },
          { title: 'Duplicates', dataIndex: 'duplicates' },
          {
            title: 'Result',
            dataIndex: 'status',
            render: (_, row) => <SourceResultTag status={row.status} />,
          },
        ]}
      />
    </div>
  );
};

/** Runs tab: research history with per-source results (E02-S05). */
const RunsTab: React.FC<TabProps & { onRunResearch?: () => void }> = ({
  account,
  refreshKey,
  plans,
  onRunResearch,
}) => {
  const actionRef = useRef<ActionType>(undefined);
  const [error, setError] = useState<unknown>(null);
  useReloadOnChange(actionRef, refreshKey);
  const reload = () => actionRef.current?.reload();

  const columns: ProColumns<ResearchRun>[] = [
    {
      title: 'Started',
      dataIndex: 'started_at',
      render: (_, row) => <DateTime value={row.started_at} />,
    },
    {
      title: 'Started by',
      dataIndex: 'started_by',
      render: (_, row) => row.started_by?.name ?? 'System',
    },
    {
      title: 'Plan',
      dataIndex: 'plan',
      render: (_, row) => {
        if (!row.plan) return 'No plan';
        const plan = plans.find((item) => item.id === row.plan);
        return plan ? planLabel(plan) : `Plan #${row.plan}`;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 220,
      render: (_, row) =>
        row.status === 'running' && row.job ? (
          <JobProgress
            job={row.job}
            variant="inline"
            onDone={reload}
            onFailed={reload}
          />
        ) : (
          <StatusTag kind="research_run" status={row.status} />
        ),
    },
    {
      title: 'New signals',
      dataIndex: ['stats', 'signals'],
      render: (_, row) => row.stats?.signals ?? '—',
    },
    {
      title: 'Duplicates',
      dataIndex: ['stats', 'duplicates'],
      render: (_, row) => row.stats?.duplicates ?? '—',
    },
    {
      title: 'Topics',
      dataIndex: ['stats', 'topics'],
      render: (_, row) => {
        if (row.stats?.synthesis === 'skipped_too_few_signals') {
          return (
            <Tooltip title="Not enough signals to form topics">
              <span>Skipped</span>
            </Tooltip>
          );
        }
        if (row.stats?.synthesis === 'skipped') return '—';
        return row.stats?.topics ?? '—';
      },
    },
    {
      title: 'Duration',
      dataIndex: 'finished_at',
      render: (_, row) => formatDuration(row.started_at, row.finished_at),
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
      <ProTable<ResearchRun>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        search={false}
        options={false}
        toolBarRender={false}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        expandable={{
          expandedRowRender: (row) => (
            <RunSources accountId={account.id} run={row} />
          ),
        }}
        request={async (params) => {
          try {
            const page = await listRuns({
              account: account.id,
              ...toPageParams(params),
            });
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
        locale={{
          emptyText: (
            <Empty description="Research has not run for this account yet.">
              {onRunResearch ? (
                <Button type="primary" onClick={onRunResearch}>
                  Run research
                </Button>
              ) : null}
            </Empty>
          ),
        }}
      />
    </ProCard>
  );
};

export default RunsTab;
