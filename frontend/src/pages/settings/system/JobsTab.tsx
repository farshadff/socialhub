import { ReloadOutlined } from '@ant-design/icons';
import {
  type ActionType,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import {
  Button,
  Drawer,
  Flex,
  Progress,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import dayjs from 'dayjs';
import React, { useRef, useState } from 'react';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  ACTIVE_STATUSES,
  isActive,
  type Job,
  type JobStatus,
  jobKindLabel,
  listJobs,
} from '@/services/socialhub/jobs';
import { jobErrorText } from '@/utils/errorText';
import {
  DetailRows,
  formatDuration,
  JsonBlock,
  useAllAccounts,
} from './shared';

type AccountFilter = number | 'none';

type Params = {
  current?: number;
  pageSize?: number;
  status?: JobStatus[];
  kind_prefix?: string;
  account?: AccountFilter;
};

export const JOBS_REFRESH_MS = 10_000;

const STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Time from start (or creation while queued) to finish, or to now while active. */
export function jobDuration(job: Job, now = dayjs()): number | null {
  const from = job.started_at ?? null;
  if (!from) return null;
  const to = job.finished_at ? dayjs(job.finished_at) : now;
  return to.diff(dayjs(from));
}

const Target: React.FC<{ job: Job }> = ({ job }) => {
  const text = `${job.target_type} #${job.target_id}`;
  return job.target_type === 'content_item' ? (
    <Link
      to={`/content/${job.target_id}`}
      onClick={(event) => event.stopPropagation()}
    >
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  );
};

const JobDrawer: React.FC<{
  job: Job | null;
  handleOf: (id: number | null) => string | null;
  onClose: () => void;
}> = ({ job, handleOf, onClose }) => {
  const { token } = theme.useToken();
  return (
    <Drawer
      open={job !== null}
      onClose={onClose}
      title={job ? jobKindLabel(job.kind) : 'Task'}
      size="large"
      destroyOnHidden
    >
      {job ? (
        <Flex vertical gap={token.marginLG}>
          <DetailRows
            rows={[
              {
                label: 'ID',
                children: <Typography.Text copyable>{job.id}</Typography.Text>,
              },
              {
                label: 'Kind',
                children: (
                  <>
                    {jobKindLabel(job.kind)}{' '}
                    <Typography.Text code>{job.kind}</Typography.Text>
                  </>
                ),
              },
              {
                label: 'Status',
                children: <StatusTag kind="job" status={job.status} />,
              },
              { label: 'Progress', children: `${job.progress}%` },
              { label: 'Message', children: job.message || '—' },
              {
                label: 'Account',
                children:
                  job.account === null ? 'System' : handleOf(job.account),
              },
              { label: 'Queue', children: job.queue },
              { label: 'Target', children: <Target job={job} /> },
              {
                label: 'Created',
                children: <DateTime value={job.created_at} />,
              },
              {
                label: 'Started',
                children: <DateTime value={job.started_at} />,
              },
              {
                label: 'Finished',
                children: <DateTime value={job.finished_at} />,
              },
              { label: 'Duration', children: formatDuration(jobDuration(job)) },
              {
                label: 'Started by',
                children: job.created_by?.name ?? 'System',
              },
              { label: 'Error code', children: job.error_code || '—' },
              { label: 'Error detail', children: job.error_detail || '—' },
              {
                label: 'Request ID',
                children: job.request_id ? (
                  <Typography.Text copyable>{job.request_id}</Typography.Text>
                ) : (
                  '—'
                ),
              },
            ]}
          />
          <Flex vertical gap={token.marginXS}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              Result
            </Typography.Title>
            {job.result ? (
              <JsonBlock label="Result" value={job.result} />
            ) : (
              <Typography.Text type="secondary">No result.</Typography.Text>
            )}
          </Flex>
        </Flex>
      ) : null}
    </Drawer>
  );
};

/** Recent jobs tab (E00-S06 FE3): every account's jobs and system jobs, for admins. */
const JobsTab: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [error, setError] = useState<unknown>(null);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const { handleOf, options } = useAllAccounts();
  const accountOptions = [{ value: 'none', label: 'System' }, ...options];

  const columns: ProColumns<Job>[] = [
    {
      title: 'Started',
      dataIndex: 'started_at',
      search: false,
      render: (_, row) => <DateTime value={row.started_at ?? row.created_at} />,
    },
    {
      title: 'Kind',
      dataIndex: 'kind',
      search: false,
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={(event) => {
            event.stopPropagation();
            setOpenJob(row);
          }}
        >
          {jobKindLabel(row.kind)}
        </Button>
      ),
    },
    {
      title: 'Kind prefix',
      dataIndex: 'kind_prefix',
      hideInTable: true,
      fieldProps: { placeholder: 'For example production.' },
    },
    {
      title: 'Account',
      dataIndex: 'account',
      valueType: 'select',
      fieldProps: { showSearch: true, options: accountOptions },
      render: (_, row) =>
        row.account === null ? 'System' : handleOf(row.account),
    },
    {
      title: 'Target',
      key: 'target',
      search: false,
      render: (_, row) => <Target job={row} />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      valueType: 'select',
      fieldProps: { mode: 'multiple', options: STATUS_OPTIONS },
      render: (_, row) => <StatusTag kind="job" status={row.status} />,
    },
    {
      title: 'Progress',
      dataIndex: 'progress',
      search: false,
      width: 140,
      render: (_, row) => (
        <Progress
          percent={row.progress}
          size="small"
          status={
            isActive(row.status)
              ? 'active'
              : row.status === 'succeeded'
                ? 'success'
                : row.status === 'failed'
                  ? 'exception'
                  : 'normal'
          }
          aria-label={`Progress ${row.progress}%`}
        />
      ),
    },
    {
      title: 'Duration',
      key: 'duration',
      search: false,
      render: (_, row) => formatDuration(jobDuration(row)),
    },
    {
      title: 'Error',
      key: 'error',
      search: false,
      ellipsis: true,
      render: (_, row) =>
        row.status === 'failed' || row.status === 'cancelled' ? (
          <Tooltip title={row.error_code ?? undefined}>
            <Typography.Text type="danger">{jobErrorText(row)}</Typography.Text>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: 'Started by',
      dataIndex: 'created_by',
      search: false,
      render: (_, row) => row.created_by?.name ?? 'System',
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
      <ProTable<Job, Params>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        options={false}
        scroll={{ x: 1300 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        locale={{ emptyText: 'No background tasks yet.' }}
        polling={(rows) =>
          rows?.some((row) => ACTIVE_STATUSES.includes(row.status))
            ? JOBS_REFRESH_MS
            : 0
        }
        toolBarRender={() => [
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={() => actionRef.current?.reload()}
          >
            Refresh
          </Button>,
        ]}
        onRow={(row) => ({
          onClick: () => setOpenJob(row),
          style: { cursor: 'pointer' },
        })}
        request={async ({
          current,
          pageSize,
          status,
          kind_prefix,
          account,
        }) => {
          try {
            const page = await listJobs({
              page: current,
              page_size: pageSize,
              status: status?.length ? status : undefined,
              kind_prefix: kind_prefix?.trim() || undefined,
              account: account ?? undefined,
              ordering: '-created_at',
            });
            return { data: page.results, total: page.count, success: true };
          } catch (err) {
            setError(err);
            return { data: [], total: 0, success: false };
          }
        }}
      />
      <JobDrawer
        job={openJob}
        handleOf={handleOf}
        onClose={() => setOpenJob(null)}
      />
    </>
  );
};

export default JobsTab;
