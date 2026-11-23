import { ProCard } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Empty,
  Modal,
  message,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useRef, useState } from 'react';
import DateTime, { formatDateTime } from '@/components/DateTime';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import useFormats from '@/pages/content/shared/useFormats';
import {
  approveBrief,
  type BriefResource,
  generateBrief,
  getBrief,
  listBriefVersions,
  type ValidationIssue,
} from '@/services/socialhub/briefs';
import { getPlanForContent, listContentEvents } from '@/services/socialhub/content';
import { isApiError } from '@/services/socialhub/http';
import { isActive } from '@/services/socialhub/jobs';
import { useCurrentAccount } from '@/utils/accountRequest';
import { errorText, jobErrorText, notifyError } from '@/utils/errorText';
import type { WorkspaceTabProps } from '../../types';
import BriefEditor from './BriefEditor';
import {
  type BriefFormValues,
  defaultMetricFor,
  emptyFields,
  fieldsOf,
  issueLabel,
  originText,
  STATUS_WORD,
  warningText,
} from './briefLogic';
import BriefView from './BriefView';
import RegenerateBriefModal from './RegenerateBriefModal';

const WRITABLE = ['selected', 'briefed', 'scripted'];
const FAILED_HOLD = 'Brief could not be written';

type EditSession = {
  initial: BriefFormValues;
  baseVersion: number;
  issues?: ValidationIssue[];
  focusPath?: string | null;
};

/** The Brief tab of the item workspace (E04-S03). */
const BriefTab: React.FC<WorkspaceTabProps> = ({ item, reload, openFormatModal }) => {
  const { token } = theme.useToken();
  const { account } = useCurrentAccount();
  const { roleInfo } = useFormats();
  const tz = account?.timezone ?? 'UTC';
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditSession | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const briefQuery = useQuery({
    queryKey: [item.account, 'brief', item.id, viewVersion ?? 'latest'],
    queryFn: () => getBrief(item.id, viewVersion ?? undefined),
  });
  const resource = briefQuery.data;
  const latestVersion = resource?.latest_version ?? 0;

  const versionsQuery = useQuery({
    queryKey: [item.account, 'brief-versions', item.id, latestVersion],
    enabled: latestVersion > 0,
    queryFn: () => listBriefVersions(item.id),
  });

  const planId = item.plan?.id ?? null;
  const planQuery = useQuery({
    queryKey: [item.account, 'plan', planId],
    enabled: planId !== null,
    queryFn: () => getPlanForContent(planId as number),
  });
  const planMetrics = planQuery.data?.success_metrics;

  const failedHold = item.hold_reason.startsWith(FAILED_HOLD);
  const failureQuery = useQuery({
    queryKey: [item.account, 'brief-failure', item.id, item.updated_at],
    enabled: failedHold,
    queryFn: () => listContentEvents(item.id, { type: ['job_failed'], page_size: 10 }),
  });
  const failure = failureQuery.data?.results.find((event) =>
    String(event.data?.kind ?? '').startsWith('brief.'),
  );

  const job = item.active_job && isActive(item.active_job.status) ? item.active_job : null;
  const briefJob = job && (job.kind ?? '').startsWith('brief.') ? job : null;

  // Reload the brief when a job on the item ends (the shell polls the item while it runs).
  const lastJobId = useRef<string | null>(job?.id ?? null);
  useEffect(() => {
    const current = job?.id ?? null;
    if (lastJobId.current && current !== lastJobId.current) {
      briefQuery.refetch();
      versionsQuery.refetch();
    }
    lastJobId.current = current;
  }, [job?.id]);

  const refresh = async () => {
    setViewVersion(null);
    await Promise.all([briefQuery.refetch(), reload()]);
  };

  const locked = !WRITABLE.includes(item.status);
  const actions = resource?.actions ?? { can_generate: false, can_edit: false, can_approve: false };
  // `show` follows the server; a running job keeps buttons visible but disabled (DESIGN-SYSTEM §7).
  const show = {
    generate: actions.can_generate && !locked,
    edit: actions.can_edit && !locked,
    approve: actions.can_approve && !locked,
  };
  const can = {
    generate: show.generate && !job,
    edit: show.edit && !job,
    approve: show.approve && !job,
  };
  const jobReason = job ? `${job.message || 'Another task'} is running.` : undefined;
  const brief = resource?.brief ?? null;
  const viewingOld = brief !== null && brief.version !== latestVersion;
  const canChangeRole = item.allowed_actions.includes('edit_format');

  const start = async (body: { feedback?: string; base_version?: number } = {}) => {
    setBusy(true);
    try {
      await generateBrief(item.id, body);
      await reload();
    } catch (error) {
      if (isApiError(error) && error.code === 'job_in_progress') {
        message.info('Already running. Showing its progress.');
        await reload();
      } else if (isApiError(error) && error.code === 'version_conflict') {
        message.warning(errorText(error));
        await refresh();
      } else {
        notifyError(error);
      }
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    if (!brief) return;
    const version = brief.version;
    const run = async () => {
      try {
        await approveBrief(item.id, version);
        message.success('Brief approved');
        await refresh();
      } catch (error) {
        if (isApiError(error) && error.status === 409) {
          notifyError(error);
          await refresh();
        } else {
          notifyError(error);
        }
      }
    };
    if (item.status === 'scripted') {
      Modal.confirm({
        title: `Approve brief v${version}?`,
        content: 'The approved script will be replaced and written again.',
        okText: 'Approve brief',
        onOk: run,
      });
    } else {
      run();
    }
  };

  const defaultMetric =
    defaultMetricFor(item.role ? roleInfo(item.role) : undefined, item.format) ?? 'reach';

  const writeByHand = () =>
    setEditing({ initial: emptyFields(defaultMetric), baseVersion: 0 });

  const editFrom = (focusPath?: string | null) => {
    if (!brief) return;
    setEditing({
      initial: fieldsOf(brief, viewingOld ? `Restored from v${brief.version}` : ''),
      baseVersion: latestVersion,
      issues: viewingOld ? undefined : resource?.validation.issues,
      focusPath,
    });
  };

  const onSaved = (saved: BriefResource) => {
    setEditing(null);
    setViewVersion(null);
    briefQuery.refetch();
    reload();
    return saved;
  };

  // ── Loading and error ──────────────────────────────────────────────────────────────────
  if (briefQuery.isLoading) {
    return (
      <ProCard>
        <Skeleton active paragraph={{ rows: 8 }} />
      </ProCard>
    );
  }
  if (briefQuery.isError) {
    return <PageError error={briefQuery.error} onRetry={() => briefQuery.refetch()} />;
  }

  const lockedBanner =
    locked && item.status !== 'cancelled' ? (
      <Alert type="info" showIcon title="The brief is locked because production has started." />
    ) : null;

  const failedAlert =
    failedHold && !job ? (
      <Alert
        type="error"
        showIcon
        title={`The brief could not be written: ${
          failure?.data?.error_code
            ? jobErrorText({ error_code: String(failure.data.error_code) })
            : item.hold_reason
        }`}
        action={
          <Space>
            <Button
              size="small"
              loading={busy}
              disabled={!can.generate && latestVersion > 0}
              onClick={() => start(latestVersion > 0 ? { base_version: latestVersion } : {})}
            >
              Try again
            </Button>
            <Tooltip title={item.role ? undefined : 'Set a role first'}>
              <Button
                size="small"
                disabled={!item.role || locked}
                onClick={brief ? () => editFrom() : writeByHand}
              >
                Write by hand
              </Button>
            </Tooltip>
          </Space>
        }
      />
    ) : null;

  // ── Edit mode ──────────────────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <ProCard
        title={
          editing.baseVersion === 0 ? 'Write the brief' : `Edit brief · new version v${latestVersion + 1}`
        }
      >
        <BriefEditor
          item={item}
          initial={editing.initial}
          baseVersion={editing.baseVersion}
          planMetrics={planMetrics}
          issues={editing.issues}
          focusPath={editing.focusPath}
          onSaved={onSaved}
          onExit={(reloadLatest) => {
            setEditing(null);
            if (reloadLatest) refresh();
          }}
        />
      </ProCard>
    );
  }

  // ── No brief ───────────────────────────────────────────────────────────────────────────
  if (!brief) {
    return (
      <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
        {lockedBanner}
        {failedAlert}
        {briefJob ? (
          <ProCard>
            <JobProgress job={briefJob} title="Writing brief" variant="inline" />
            <Skeleton paragraph={{ rows: 6 }} />
          </ProCard>
        ) : failedHold ? null : (
          <ProCard>
            <Empty description="No brief yet.">
              <Space>
                <Tooltip title={jobReason}>
                  <Button
                    type="primary"
                    loading={busy}
                    disabled={locked || Boolean(job)}
                    onClick={() => start()}
                  >
                    Generate brief
                  </Button>
                </Tooltip>
                <Tooltip title={item.role ? jobReason : 'Set a role first'}>
                  <Button disabled={!item.role || locked || Boolean(job)} onClick={writeByHand}>
                    Write by hand
                  </Button>
                </Tooltip>
              </Space>
            </Empty>
          </ProCard>
        )}
      </Space>
    );
  }

  // ── A brief exists ─────────────────────────────────────────────────────────────────────
  const versionOptions = (versionsQuery.data?.results ?? []).map((v) => ({
    value: v.version,
    label: `v${v.version} · ${STATUS_WORD[v.status]} · ${originText(v)} · ${formatDateTime(v.created_at, tz)}`,
  }));
  if (versionOptions.length === 0) {
    versionOptions.push({ value: brief.version, label: `v${brief.version}` });
  }

  const issues = viewingOld ? [] : (resource?.validation.issues ?? []);
  const approvedVersion = resource?.approved_version ?? null;
  const latestIsSuperseded = !viewingOld && brief.status === 'superseded';
  const pendingDraft =
    !viewingOld &&
    brief.status === 'draft' &&
    approvedVersion !== null &&
    (item.status === 'briefed' || item.status === 'scripted');

  const withJobTooltip = (button: React.ReactNode, key: string) => (
    <Tooltip key={key} title={jobReason}>
      {button}
    </Tooltip>
  );
  const headerActions = (
    <Space wrap>
      {show.approve && !viewingOld && brief.status === 'draft'
        ? withJobTooltip(
            <Button type="primary" disabled={!can.approve} onClick={approve}>
              Approve brief
            </Button>,
            'approve',
          )
        : null}
      {show.edit && viewingOld
        ? withJobTooltip(
            <Button disabled={!can.edit} onClick={() => editFrom()}>
              Use this version
            </Button>,
            'restore',
          )
        : null}
      {show.edit && !viewingOld
        ? withJobTooltip(
            <Button disabled={!can.edit} onClick={() => editFrom()}>
              Edit
            </Button>,
            'edit',
          )
        : null}
      {show.generate
        ? withJobTooltip(
            <Button disabled={!can.generate} onClick={() => setRegenerateOpen(true)}>
              Regenerate
            </Button>,
            'regenerate',
          )
        : null}
    </Space>
  );

  return (
    <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
      <ProCard
        title={
          <Space size={token.marginXS} wrap>
            <span>Brief v{brief.version}</span>
            <StatusTag kind="brief" status={brief.status} />
            <Tag>{originText(brief)}</Tag>
            <Typography.Text type="secondary">
              <DateTime value={brief.created_at} />
            </Typography.Text>
          </Space>
        }
        extra={headerActions}
        headerBordered
      >
        <Space size={token.marginXS}>
          <Typography.Text type="secondary">Version</Typography.Text>
          <Select
            aria-label="Brief version"
            value={brief.version}
            loading={versionsQuery.isLoading}
            options={versionOptions}
            popupMatchSelectWidth={false}
            style={{ minWidth: 220 }}
            onChange={(version: number) =>
              setViewVersion(version === latestVersion ? null : version)
            }
          />
        </Space>
      </ProCard>

      {lockedBanner}
      {briefJob ? <JobProgress job={briefJob} title="Writing brief" variant="inline" /> : null}
      {failedAlert}
      {issues.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} must be fixed before this brief can be approved.`}
          description={
            <ul style={{ margin: 0, paddingInlineStart: token.paddingMD }}>
              {issues.map((issue) => (
                <li key={`${issue.path}:${issue.code}`}>
                  <Typography.Text strong>{issueLabel(issue)}:</Typography.Text> {issue.message}{' '}
                  {can.edit ? (
                    <Typography.Link onClick={() => editFrom(issue.path)}>Edit</Typography.Link>
                  ) : null}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
      {!viewingOld
        ? (resource?.warnings ?? []).map((warning) => (
            <Alert
              key={typeof warning === 'string' ? warning : warning.code}
              type="info"
              showIcon
              title={warningText(warning, brief, planMetrics)}
            />
          ))
        : null}
      {viewingOld ? (
        <Alert
          type="info"
          showIcon
          title={`You are viewing version ${brief.version} (${STATUS_WORD[brief.status].toLowerCase()}). The latest is version ${latestVersion}.`}
          action={
            <Button size="small" onClick={() => setViewVersion(null)}>
              Back to latest
            </Button>
          }
        />
      ) : null}
      {latestIsSuperseded ? (
        <Alert
          type="info"
          showIcon
          title="The brief was replaced after the format or role changed."
          action={
            can.generate ? (
              <Button size="small" loading={busy} onClick={() => start({ base_version: latestVersion })}>
                Generate brief
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {pendingDraft ? (
        <Alert
          type="info"
          showIcon
          title={`Version ${brief.version} is waiting for approval. Until then the script uses approved version ${approvedVersion}.`}
        />
      ) : null}

      <ProCard>
        <BriefView
          brief={brief}
          format={item.format}
          onChangeRole={canChangeRole && !viewingOld ? openFormatModal : undefined}
        />
      </ProCard>

      <RegenerateBriefModal
        open={regenerateOpen}
        itemId={item.id}
        baseVersion={latestVersion}
        onClose={() => setRegenerateOpen(false)}
        onStarted={() => reload()}
        onConflict={() => refresh()}
      />
    </Space>
  );
};

export default BriefTab;
