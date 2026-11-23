import {
  type ActionType,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Button, Drawer, Flex, Skeleton, Typography, theme } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import React, { useRef, useState } from 'react';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  type AiRun,
  type AiRunStatus,
  type AiRunTotals,
  aiProviderLabel,
  getAiRun,
  listAiRuns,
} from '@/services/socialhub/ai';
import {
  DetailRows,
  formatCost,
  formatNumber,
  formatSeconds,
  JsonBlock,
  useAllAccounts,
} from './shared';

type Params = {
  current?: number;
  pageSize?: number;
  task?: string;
  account?: number;
  status?: AiRunStatus;
  created_after?: string;
  created_before?: string;
};

const STATUS_OPTIONS = [
  { value: 'ok', label: 'OK' },
  { value: 'error', label: 'Error' },
  { value: 'refused', label: 'Refused' },
];

/** "{calls} calls · {input} tokens in · {output} tokens out · ${cost}". */
export function totalsLine(totals: AiRunTotals): string {
  const calls = totals.calls === 1 ? 'call' : 'calls';
  return `${formatNumber(totals.calls)} ${calls} · ${formatNumber(totals.input_tokens)} tokens in · ${formatNumber(totals.output_tokens)} tokens out · ${formatCost(totals.cost_usd)}`;
}

const AiRunDrawer: React.FC<{
  runId: number | null;
  handleOf: (id: number | null) => string | null;
  onClose: () => void;
}> = ({ runId, handleOf, onClose }) => {
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: ['ai-runs', runId],
    queryFn: () => getAiRun(runId as number),
    enabled: runId !== null,
  });
  const run = query.data;
  let body: React.ReactNode;
  if (query.isPending) body = <Skeleton active />;
  else if (query.isError) {
    body = <PageError error={query.error} onRetry={() => query.refetch()} />;
  } else if (run) {
    body = (
      <Flex vertical gap={token.marginLG}>
        <DetailRows
          rows={[
            { label: 'Time', children: <DateTime value={run.created_at} /> },
            {
              label: 'Task',
              children: (
                <>
                  {run.task} (prompt version {run.prompt_version})
                </>
              ),
            },
            { label: 'Account', children: handleOf(run.account) ?? '—' },
            { label: 'Provider', children: aiProviderLabel(run.provider) },
            { label: 'Model', children: run.model || '—' },
            {
              label: 'Tokens in / out',
              children: (
                <>
                  {formatNumber(run.input_tokens)} /{' '}
                  {formatNumber(run.output_tokens)}
                </>
              ),
            },
            { label: 'Cost', children: formatCost(run.cost_usd) },
            { label: 'Duration', children: formatSeconds(run.latency_ms) },
            {
              label: 'Status',
              children: <StatusTag kind="ai_run" status={run.status} />,
            },
            { label: 'Error code', children: run.error_code || '—' },
            {
              label: 'Job',
              children: run.job ? (
                <Typography.Text copyable>{run.job}</Typography.Text>
              ) : (
                '—'
              ),
            },
            {
              label: 'Provider request ID',
              children: run.provider_request_id ? (
                <Typography.Text copyable>
                  {run.provider_request_id}
                </Typography.Text>
              ) : (
                '—'
              ),
            },
            {
              label: 'Units',
              children: Object.keys(run.units ?? {}).length ? (
                <Typography.Text code>
                  {JSON.stringify(run.units)}
                </Typography.Text>
              ) : (
                '—'
              ),
            },
          ]}
        />
        {run.payload ? (
          <>
            <Flex vertical gap={token.marginXS}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                Request
              </Typography.Title>
              <JsonBlock label="Request" value={run.payload.request ?? null} />
            </Flex>
            <Flex vertical gap={token.marginXS}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                Response
              </Typography.Title>
              <JsonBlock
                label="Response"
                value={run.payload.response ?? null}
              />
            </Flex>
            {run.payload.truncated ? (
              <Typography.Text type="secondary">
                The payload was shortened to 64 KB when it was stored.
              </Typography.Text>
            ) : null}
          </>
        ) : (
          <Typography.Text type="secondary">
            Payload removed after 30 days.
          </Typography.Text>
        )}
      </Flex>
    );
  }
  return (
    <Drawer
      open={runId !== null}
      onClose={onClose}
      title={run ? `AI call ${run.id}` : 'AI call'}
      size="large"
      destroyOnHidden
    >
      {body}
    </Drawer>
  );
};

/** AI calls tab (E00-S05 FE2): `GET /ai/runs/` with totals and a detail drawer. */
const AiCallsTab: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [error, setError] = useState<unknown>(null);
  const [totals, setTotals] = useState<AiRunTotals | null>(null);
  const [tasks, setTasks] = useState<string[]>([]);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const { handleOf, options: accountOptions } = useAllAccounts();

  const columns: ProColumns<AiRun>[] = [
    {
      title: 'Time',
      dataIndex: 'created_at',
      search: false,
      render: (_, row) => <DateTime value={row.created_at} />,
    },
    {
      title: 'Task',
      dataIndex: 'task',
      valueType: 'select',
      fieldProps: {
        showSearch: true,
        options: tasks.map((task) => ({ value: task, label: task })),
      },
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={(event) => {
            event.stopPropagation();
            setOpenRun(row.id);
          }}
        >
          {row.task}
        </Button>
      ),
    },
    {
      title: 'Account',
      dataIndex: 'account',
      valueType: 'select',
      fieldProps: { showSearch: true, options: accountOptions },
      render: (_, row) => handleOf(row.account) ?? '—',
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      search: false,
      render: (_, row) => aiProviderLabel(row.provider),
    },
    { title: 'Model', dataIndex: 'model', search: false },
    {
      title: 'Tokens in / out',
      key: 'tokens',
      search: false,
      align: 'right',
      render: (_, row) =>
        `${formatNumber(row.input_tokens)} / ${formatNumber(row.output_tokens)}`,
    },
    {
      title: 'Cost (USD)',
      dataIndex: 'cost_usd',
      search: false,
      align: 'right',
      render: (_, row) => formatCost(row.cost_usd),
    },
    {
      title: 'Duration',
      dataIndex: 'latency_ms',
      search: false,
      align: 'right',
      render: (_, row) => formatSeconds(row.latency_ms),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      valueType: 'select',
      fieldProps: { options: STATUS_OPTIONS },
      render: (_, row) => <StatusTag kind="ai_run" status={row.status} />,
    },
    {
      title: 'Date range',
      dataIndex: 'created',
      valueType: 'dateRange',
      hideInTable: true,
      initialValue: [dayjs().subtract(7, 'day'), dayjs()],
      search: {
        transform: (value: [string | Dayjs, string | Dayjs] | undefined) =>
          value?.[0] && value?.[1]
            ? {
                created_after: dayjs(value[0]).startOf('day').toISOString(),
                created_before: dayjs(value[1]).endOf('day').toISOString(),
              }
            : {},
      },
    },
  ];

  if (error) {
    return (
      <PageError
        error={error}
        onRetry={() => {
          setError(null);
          actionRef.current?.reload();
        }}
      />
    );
  }

  return (
    <>
      <ProTable<AiRun, Params>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        options={false}
        scroll={{ x: 1200 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        headerTitle={
          totals ? (
            <Typography.Text type="secondary">
              {totalsLine(totals)}
            </Typography.Text>
          ) : null
        }
        locale={{ emptyText: 'No AI calls in this period.' }}
        onRow={(row) => ({
          onClick: () => setOpenRun(row.id),
          style: { cursor: 'pointer' },
        })}
        request={async ({
          current,
          pageSize,
          task,
          account,
          status,
          created_after,
          created_before,
        }) => {
          try {
            const page = await listAiRuns({
              page: current,
              page_size: pageSize,
              task,
              account,
              status,
              created_after,
              created_before,
            });
            setTotals(page.totals ?? null);
            setTasks((known) =>
              Array.from(
                new Set([...known, ...page.results.map((run) => run.task)]),
              ).sort(),
            );
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
      />
      <AiRunDrawer
        runId={openRun}
        handleOf={handleOf}
        onClose={() => setOpenRun(null)}
      />
    </>
  );
};

export default AiCallsTab;
