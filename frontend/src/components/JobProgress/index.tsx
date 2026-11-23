import { useModel } from '@umijs/max';
import { Alert, Button, Card, Flex, Progress, Spin, Typography } from 'antd';
import dayjs from 'dayjs';
import React from 'react';
import StatusTag from '@/components/StatusTag';
import { useJob } from '@/hooks/useJob';
import { isActive, type Job, type JobSummary } from '@/services/socialhub/jobs';
import { jobErrorText } from '@/utils/errorText';

export type JobProgressProps = {
  /** The job to follow (for example a resource's `active_job`); `jobId` wins when both are given. */
  job?: Job | JobSummary | null;
  jobId?: string | null;
  /** Heading of the card variant. */
  title?: React.ReactNode;
  /** `card` with a heading (default) or one `inline` block. */
  variant?: 'card' | 'inline';
  onDone?: (job: Job) => void;
  onFailed?: (job: Job) => void;
  /** When given, a failed job shows "Try again". */
  onRetry?: () => void;
  /** Replaces the failure text, for example per `error_code`. */
  failureText?: (job: Job) => string;
};

/** "Running for 2 min", from `started_at` (or `created_at` while queued). */
export function elapsedText(
  job: Pick<Job, 'started_at' | 'created_at'>,
  now = dayjs(),
): string | null {
  const from = job.started_at ?? job.created_at;
  if (!from) return null;
  const minutes = now.diff(dayjs(from), 'minute');
  const verb = job.started_at ? 'Running' : 'Waiting';
  if (minutes < 1) return `${verb} for less than a minute`;
  if (minutes < 60) return `${verb} for ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${verb} for ${hours} h ${minutes % 60} min`;
}

/**
 * A job's state where there is room for it (E00-S06 "JobProgress"): status tag, progress bar,
 * message and elapsed time; a `Spin` while running at 0%; the error text when it failed (and, for
 * admins, `error_detail`); a warning while the server can't be reached.
 */
const JobProgress: React.FC<JobProgressProps> = ({
  job: given,
  jobId,
  title,
  variant = 'card',
  onDone,
  onFailed,
  onRetry,
  failureText,
}) => {
  const id = jobId ?? given?.id ?? null;
  const { job, connectionProblem, notFound } = useJob(id, {
    onDone,
    onFailed,
  });
  const isAdmin =
    useModel('@@initialState')?.initialState?.currentUser?.access === 'admin';
  const current = (job ?? given ?? null) as (JobSummary & Partial<Job>) | null;

  if (!id) return null;

  let body: React.ReactNode;
  if (notFound) {
    body = (
      <Typography.Text type="secondary">
        This task no longer exists.
      </Typography.Text>
    );
  } else if (!current) {
    body = <Spin size="small" />;
  } else {
    const running = isActive(current.status);
    const failed =
      current.status === 'failed' || current.status === 'cancelled';
    const elapsed =
      running && (current.started_at || current.created_at)
        ? elapsedText(current as Job)
        : null;
    body = (
      <Flex vertical gap={4} style={{ width: '100%' }}>
        <Flex gap={8} wrap align="center">
          <StatusTag kind="job" status={current.status} />
          {running && current.progress > 0 && current.message ? (
            <Typography.Text>{current.message}</Typography.Text>
          ) : null}
          {elapsed ? (
            <Typography.Text type="secondary">{elapsed}</Typography.Text>
          ) : null}
        </Flex>
        {running && current.progress === 0 ? (
          <Flex gap={8} align="center">
            <Spin size="small" />
            <Typography.Text type="secondary">
              {current.message || 'Working…'}
            </Typography.Text>
          </Flex>
        ) : (
          <Progress
            percent={current.progress}
            size="small"
            status={running ? 'active' : failed ? 'exception' : 'success'}
            aria-label="Progress"
          />
        )}
        {failed ? (
          <Flex vertical gap={4}>
            <Flex gap={8} wrap align="center">
              <Typography.Text type="danger">
                {failureText
                  ? failureText(current as Job)
                  : jobErrorText(current)}
              </Typography.Text>
              {onRetry ? (
                <Button size="small" onClick={onRetry}>
                  Try again
                </Button>
              ) : null}
            </Flex>
            {isAdmin && current.error_detail ? (
              <Typography.Text type="secondary">
                {current.error_detail}
              </Typography.Text>
            ) : null}
          </Flex>
        ) : null}
        {connectionProblem ? (
          <Alert
            type="warning"
            showIcon
            title="Can't reach the server. Still trying…"
          />
        ) : null}
      </Flex>
    );
  }

  if (variant === 'inline') return <div>{body}</div>;
  return (
    <Card size="small" title={title}>
      {body}
    </Card>
  );
};

export default JobProgress;
