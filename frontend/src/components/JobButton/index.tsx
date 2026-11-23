import {
  Button,
  type ButtonProps,
  Modal,
  message,
  notification,
  Tooltip,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import { useJob } from '@/hooks/useJob';
import { isApiError } from '@/services/socialhub/http';
import {
  isActive,
  type Job,
  type JobSummary,
  jobKindLabel,
} from '@/services/socialhub/jobs';
import { jobErrorText, notifyError } from '@/utils/errorText';

export type JobButtonProps = {
  /** Calls the endpoint that answers `202 {"job": …}`. */
  start: () => Promise<{ job: Job }>;
  /**
   * The resource's `active_job`, so a running job survives a reload. An active job of one of
   * `kinds` is followed; one of another kind disables the button.
   */
  activeJob?: JobSummary | null;
  /** Kinds this button starts. */
  kinds?: string[];
  /** Usually refetches the resource. */
  onDone?: (job: Job) => void;
  onFailed?: (job: Job) => void;
  /** Called with the job the button follows, whether started here or adopted from a `409`. */
  onStarted?: (job: JobSummary) => void;
  /** Return true when the caller handled an error from `start()`; otherwise a notification shows. */
  onStartError?: (error: unknown) => boolean;
  /** Default "Done". */
  successMessage?: string | ((job: Job) => string);
  /** Replaces `jobErrorText(job)` in the failure notification. */
  failureText?: (job: Job) => string;
  /** Optional `Modal.confirm` before starting. */
  confirm?: {
    title: React.ReactNode;
    content?: React.ReactNode;
    okText?: string;
  };
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  /** Tooltip while the job runs. */
  runningReason?: React.ReactNode;
  type?: ButtonProps['type'];
  size?: ButtonProps['size'];
  icon?: React.ReactNode;
  children: React.ReactNode;
};

const followable = (job: JobSummary | null | undefined, kinds?: string[]) =>
  !!job &&
  isActive(job.status) &&
  (!kinds || !job.kind || kinds.includes(job.kind));

/** "Rendering frame 3 of 5 · 60%", or "Working…" before the job reports a message. */
export function runningLabel(
  job: Pick<JobSummary, 'message' | 'progress'> | null,
) {
  const progress = job?.progress ?? 0;
  return `${job?.message || 'Working…'}${progress > 0 ? ` · ${progress}%` : ''}`;
}

/**
 * A button that starts a job and follows it until it ends (E00-S06 "JobButton").
 *
 * Click → optional confirmation → `start()`; loading from the click so a double click sends one
 * request. While the job runs the label is its message and progress and the button stays
 * disabled. A `409 job_in_progress` follows `error.details.job` instead of failing. Success shows
 * `successMessage` and calls `onDone`; failure shows a notification with the job's error text and
 * reference, calls `onFailed`, and makes the button clickable again.
 */
const JobButton: React.FC<JobButtonProps> = ({
  start,
  activeJob,
  kinds,
  onDone,
  onFailed,
  onStarted,
  onStartError,
  successMessage = 'Done',
  failureText,
  confirm,
  disabled,
  disabledReason,
  runningReason,
  type,
  size,
  icon,
  children,
}) => {
  const [jobId, setJobId] = useState<string | null>(
    followable(activeJob, kinds) ? (activeJob as JobSummary).id : null,
  );
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);

  // A running job that appears later (a refetch, or another tab started it) is followed too.
  useEffect(() => {
    if (followable(activeJob, kinds) && activeJob?.id !== jobId) {
      setJobId(activeJob?.id ?? null);
    }
  }, [activeJob?.id, activeJob?.status]);

  const label = typeof children === 'string' ? children : 'Task';

  const { job, isActive: running } = useJob(jobId, {
    onDone: (done) => {
      message.success(
        typeof successMessage === 'function'
          ? successMessage(done)
          : successMessage,
      );
      onDone?.(done);
    },
    onFailed: (failed) => {
      notification.error({
        title: `${label} failed`,
        description: (
          <>
            <div>
              {failureText ? failureText(failed) : jobErrorText(failed)}
            </div>
            <div>Reference: {failed.id}</div>
          </>
        ),
      });
      onFailed?.(failed);
    },
  });

  const follow = (next: JobSummary) => {
    setJobId(next.id);
    onStarted?.(next);
  };

  const run = async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      const response = await start();
      follow(response.job);
    } catch (error) {
      if (
        isApiError(error) &&
        error.code === 'job_in_progress' &&
        error.details.job
      ) {
        message.info('Already running. Showing its progress.');
        follow(error.details.job as JobSummary);
      } else if (!onStartError?.(error)) {
        notifyError(error);
      }
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  const onClick = () => {
    if (confirm) {
      Modal.confirm({ ...confirm, onOk: run });
    } else {
      run();
    }
  };

  const otherKind =
    !running &&
    !!activeJob &&
    isActive(activeJob.status) &&
    !!kinds &&
    !!activeJob.kind &&
    !kinds.includes(activeJob.kind);

  let tooltip: React.ReactNode;
  if (running) tooltip = runningReason;
  else if (otherKind)
    tooltip = `Another task is running: ${jobKindLabel(activeJob?.kind)}`;
  else if (disabled) tooltip = disabledReason;

  return (
    <Tooltip title={tooltip}>
      <Button
        type={type}
        size={size}
        icon={icon}
        loading={starting || (running && (job?.progress ?? 0) === 0)}
        disabled={disabled || starting || running || otherKind}
        onClick={onClick}
      >
        {running ? runningLabel(job) : children}
      </Button>
    </Tooltip>
  );
};

export default JobButton;
