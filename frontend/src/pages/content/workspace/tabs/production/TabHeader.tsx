import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  EllipsisOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import {
  Button,
  Dropdown,
  Flex,
  Modal,
  message,
  Select,
  Space,
  Steps,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React from 'react';
import FrameWarning from '@/pages/content/shared/FrameWarning';
import JobButton from '@/components/JobButton';
import { isApiError } from '@/services/socialhub/http';
import {
  type RenderWarning,
  renderProduction,
  type StepStatus,
  submitVersion,
} from '@/services/socialhub/production';
import type { TabKey } from '../../types';
import {
  blockerText,
  canResume,
  frameNeedsRender,
  productionFailureText,
  STEP_KEYS,
  STEP_LABEL,
  startJob,
  useProductionContext,
  versionLabel,
} from './shared';

const STEP_STATE_TEXT: Record<StepStatus, string> = {
  pending: 'Not started',
  running: 'Running',
  done: 'Done',
  skipped: 'Skipped',
  waiting: 'Waiting',
  failed: 'Failed',
};

export const ProductionSteps: React.FC = () => {
  const { production } = useProductionContext();
  const { token } = theme.useToken();
  const icon = (status: StepStatus) => {
    switch (status) {
      case 'done':
        return <CheckCircleFilled style={{ color: token.colorSuccess }} />;
      case 'running':
        return <LoadingOutlined style={{ color: token.colorPrimary }} />;
      case 'waiting':
        return <ClockCircleOutlined style={{ color: token.colorWarning }} />;
      case 'failed':
        return <CloseCircleFilled style={{ color: token.colorError }} />;
      case 'skipped':
        return (
          <MinusCircleOutlined style={{ color: token.colorTextQuaternary }} />
        );
      default:
        return undefined;
    }
  };
  const antStatus = (status: StepStatus) =>
    status === 'done'
      ? 'finish'
      : status === 'running'
        ? 'process'
        : status === 'failed'
          ? 'error'
          : 'wait';
  return (
    <Steps
      size="small"
      aria-label="Production steps"
      style={{ minWidth: 0, flex: 1, maxWidth: 640 }}
      items={STEP_KEYS.map((key) => {
        const status: StepStatus =
          production.production_steps[key]?.status ?? 'pending';
        return {
          key,
          title: STEP_LABEL[key],
          content: STEP_STATE_TEXT[status],
          status: antStatus(status),
          icon: icon(status),
        };
      })}
    />
  );
};

export type TabHeaderProps = {
  onSelectVersion: (version: number, isCurrent: boolean) => void;
  onOpenUpload: () => void;
  switchTab: (tab: TabKey) => void;
};

const TabHeader: React.FC<TabHeaderProps> = ({
  onSelectVersion,
  onOpenUpload,
  switchTab,
}) => {
  const { token } = theme.useToken();
  const {
    item,
    production,
    adoptableJob,
    jobRunning,
    runningReason,
    onJobStarted,
    onJobEnded,
    refetch,
    reload,
    handleError,
    isCurrentDraft,
  } = useProductionContext();
  const { actions } = production;
  const version = production.version as number;
  const isPipelineDraft = isCurrentDraft && production.origin === 'pipeline';
  const showActions = production.is_current;

  const startError = (error: unknown) => {
    handleError(error);
    return true;
  };
  const jobDone = () => {
    onJobEnded();
    refetch();
    reload();
  };

  const startOver = () => {
    Modal.confirm({
      title: 'Create a new version from the approved script?',
      content:
        'Edits made on this tab will not be carried over, except background images.',
      okText: 'Start over',
      onOk: async () => {
        try {
          const { job } = await startJob(item.id, true)();
          onJobStarted(job);
        } catch (error) {
          handleError(error);
        }
      },
    });
  };

  const needsRender =
    production.frames.some(frameNeedsRender) ||
    production.render_status === 'pending' ||
    production.render_status === 'failed';

  const holdingWarnings: RenderWarning[] = (() => {
    const codes = production.actions.holding_warnings;
    const matched = production.render_warnings.filter((w) =>
      codes.includes(w.code),
    );
    const missing = codes.filter(
      (code) => !matched.some((w) => w.code === code),
    );
    return [...matched, ...missing.map((code) => ({ code }))];
  })();

  const submit = () => {
    const acknowledge = holdingWarnings.length > 0;
    Modal.confirm({
      title: `Submit version ${version} for checking?`,
      width: 520,
      content: (
        <Flex vertical gap={token.marginSM}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            The five checks start right away. This version can't be edited after
            it is submitted.
          </Typography.Paragraph>
          {acknowledge ? (
            <>
              <Typography.Text strong>Warnings to review</Typography.Text>
              <FrameWarning warnings={holdingWarnings} showLocator />
            </>
          ) : null}
        </Flex>
      ),
      okText: acknowledge ? 'Submit anyway' : 'Submit for checking',
      onOk: async () => {
        try {
          await submitVersion(item.id, {
            base_version: version,
            acknowledge_warnings: acknowledge,
          });
          message.success('Submitted for checking');
          await reload();
          switchTab('checks');
        } catch (error) {
          if (isApiError(error) && error.code === 'invalid_transition') {
            const reason = error.details.reason;
            if (
              reason === 'not_ready' ||
              reason === 'warnings_not_acknowledged'
            ) {
              message.warning(
                'Something changed before submitting. Check the version and try again.',
              );
              refetch();
              return;
            }
          }
          handleError(error);
        }
      },
    });
  };

  const blockers = actions.submit_blockers;
  const submitDisabled =
    jobRunning || !actions.can_submit || blockers.length > 0;
  const submitTooltip = jobRunning ? (
    runningReason
  ) : blockers.length > 0 ? (
    <Flex vertical>
      {blockers.map((code) => (
        <span key={code}>{blockerText(code)}</span>
      ))}
    </Flex>
  ) : undefined;

  return (
    <ProCard size="small">
      <Flex wrap gap={token.margin} align="center" justify="space-between">
        <Flex
          wrap
          gap={token.margin}
          align="center"
          style={{ flex: 1, minWidth: 0 }}
        >
          <Select<number>
            aria-label="Version"
            value={production.version ?? undefined}
            style={{ minWidth: 220 }}
            onChange={(value) => {
              const entry = production.versions.find(
                (v) => v.version === value,
              );
              onSelectVersion(value, !!entry?.is_current);
            }}
            options={[...production.versions]
              .sort((a, b) => b.version - a.version)
              .map((entry) => ({
                value: entry.version,
                label: versionLabel(entry),
              }))}
          />
          {production.origin === 'manual_upload' ? null : <ProductionSteps />}
        </Flex>
        {showActions ? (
          <Space wrap size={token.marginXS}>
            {actions.can_start ? (
              <JobButton
                start={startJob(item.id, false)}
                activeJob={adoptableJob}
                kinds={['production.start']}
                onStarted={(job) => onJobStarted(job, true)}
                onDone={jobDone}
                onFailed={jobDone}
                onStartError={startError}
                successMessage={(job) =>
                  job.result?.waiting_for
                    ? 'Production is waiting for your input'
                    : 'Production finished'
                }
                failureText={productionFailureText}
                disabled={jobRunning}
                disabledReason={runningReason}
                runningReason={runningReason}
              >
                {isPipelineDraft && canResume(production)
                  ? 'Resume production'
                  : 'Start production'}
              </JobButton>
            ) : null}
            {actions.can_render && needsRender ? (
              <JobButton
                start={() =>
                  renderProduction(item.id, {
                    base_version: version,
                    frames: null,
                    reassemble: true,
                  })
                }
                activeJob={adoptableJob}
                kinds={['production.render']}
                onStarted={(job) => onJobStarted(job, true)}
                onDone={jobDone}
                onFailed={jobDone}
                onStartError={startError}
                successMessage="Rendered"
                failureText={productionFailureText}
                disabled={jobRunning}
                disabledReason={runningReason}
                runningReason={runningReason}
              >
                Re-render
              </JobButton>
            ) : null}
            {actions.can_upload_final ? (
              <Tooltip title={jobRunning ? runningReason : undefined}>
                <Button
                  icon={<UploadOutlined />}
                  onClick={onOpenUpload}
                  disabled={jobRunning}
                >
                  Use my own file
                </Button>
              </Tooltip>
            ) : null}
            {isCurrentDraft ? (
              <Tooltip title={submitTooltip}>
                {/* The wrapper lets the tooltip show while the button is disabled. */}
                <span
                  data-testid="submit-wrapper"
                  style={{ display: 'inline-block' }}
                >
                  <Button
                    type="primary"
                    disabled={submitDisabled}
                    onClick={submit}
                  >
                    Submit for checking
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            {actions.can_start && isPipelineDraft ? (
              <Dropdown
                disabled={jobRunning}
                trigger={['click']}
                menu={{
                  items: [{ key: 'restart', label: 'Start over from script' }],
                  onClick: startOver,
                }}
              >
                <Button
                  icon={<EllipsisOutlined />}
                  aria-label="More production actions"
                />
              </Dropdown>
            ) : null}
          </Space>
        ) : null}
      </Flex>
    </ProCard>
  );
};

export default TabHeader;
