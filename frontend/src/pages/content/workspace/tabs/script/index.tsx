import { HistoryOutlined, ReloadOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Empty,
  Modal,
  message,
  notification,
  Result,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import DateTime from '@/components/DateTime';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import StatusTag, { lookupStatus } from '@/components/StatusTag';
import type { FieldError } from '@/services/socialhub/http';
import { isApiError } from '@/services/socialhub/http';
import type { Job, JobSummary } from '@/services/socialhub/jobs';
import {
  type GenerateScriptBody,
  generateScript,
  getScriptVersion,
  type ScriptResource,
  type ScriptVersionEntry,
} from '@/services/socialhub/scripts';
import { useAccountId } from '@/utils/accountRequest';
import { fieldErrorText, jobErrorText, notifyError } from '@/utils/errorText';
import { confirmDiscard, useLeaveGuard } from '@/pages/content/shared/leaveGuard';
import { LOCKED_AFTER_PRODUCTION, type WorkspaceTabProps } from '../../types';
import { COPY, SCRIPT_EDIT_STATUSES, scriptErrorText } from './constants';
import DesignNotesCard from './DesignNotesCard';
import FrameCards from './FrameCards';
import type { FieldState } from './fields';
import ProblemsAlert from './ProblemsAlert';
import RegenerateScriptModal from './RegenerateScriptModal';
import SaveScriptModal from './SaveScriptModal';
import ScriptHistoryDrawer from './ScriptHistoryDrawer';
import ShotTable from './ShotTable';
import StoryCard from './StoryCard';
import {
  derive,
  type EditorPackage,
  fieldDomId,
  fieldLabel,
  fromPayload,
  stripPayload,
} from './scriptModel';
import { scriptVersionsKey, useScriptEditor } from './useScriptEditor';

type GenerateBody = GenerateScriptBody;

const SECTION_TITLES = ['Story', 'Shots', 'Frames', 'Design notes'];

/** "This script is locked while the item is in check." */
export function lockedText(status: string): string {
  const label = lookupStatus('item', status)?.label ?? status;
  return `This script is locked while the item is ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
}

function failureText(job: Pick<Job, 'error_code' | 'error_detail'>): string {
  return scriptErrorText(job.error_code, job.error_detail) ?? jobErrorText(job);
}

const LoadingCards: React.FC = () => {
  const { token } = theme.useToken();
  return (
    <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
      {SECTION_TITLES.map((title) => (
        <ProCard key={title} title={title} headerBordered>
          <Skeleton active />
        </ProCard>
      ))}
    </Space>
  );
};

/** The Script tab of the item workspace (E05-S01, E05-S02, E05-S03). */
const ScriptTab: React.FC<WorkspaceTabProps> = ({ item, reload, switchTab }) => {
  const { token } = theme.useToken();
  const accountId = useAccountId();
  const queryClient = useQueryClient();
  const editor = useScriptEditor(item);
  const { resource, working, dirty, handwritten, ctx } = editor;

  useLeaveGuard(dirty, COPY.leave);

  // --- permissions and read-only reasons ------------------------------------------------------
  const locked = LOCKED_AFTER_PRODUCTION.includes(item.status);
  const lockMessage = locked ? lockedText(item.status) : undefined;
  const briefApproved = item.current_brief?.status === 'approved';
  const canStart = briefApproved && SCRIPT_EDIT_STATUSES.includes(item.status) && !locked;

  // --- jobs -----------------------------------------------------------------------------------
  const activeJob = item.active_job;
  const [trackedJob, setTrackedJob] = useState<JobSummary | null>(null);
  const [failedJob, setFailedJob] = useState<Job | null>(null);
  const [providerMissing, setProviderMissing] = useState(false);
  const finishedJobs = useRef(new Set<string>());
  const lastGenerate = useRef<GenerateBody>({});

  useEffect(() => {
    if (
      activeJob?.kind?.startsWith('script.') &&
      activeJob.id !== trackedJob?.id &&
      !finishedJobs.current.has(activeJob.id)
    ) {
      setTrackedJob(activeJob);
      setFailedJob(null);
    }
  }, [activeJob?.id]);

  // When the item's job ends, the script may have a new version.
  const previousJobId = useRef(activeJob?.id ?? null);
  useEffect(() => {
    const current = activeJob?.id ?? null;
    if (previousJobId.current && !current) {
      editor.query.refetch();
      queryClient.invalidateQueries({ queryKey: scriptVersionsKey(accountId, item.id) });
    }
    previousJobId.current = current;
  }, [activeJob?.id]);

  const runningJob = trackedJob ?? activeJob ?? null;
  const jobRunning = !!runningJob;
  const jobReason = runningJob ? runningJob.message || scriptErrorText('job_in_progress') : undefined;

  const [problemsScroll, setProblemsScroll] = useState(0);
  const problemsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (problemsScroll === 0) return;
    problemsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    problemsRef.current?.focus({ preventScroll: true });
  }, [problemsScroll]);

  const onJobStarted = (job: JobSummary, body: GenerateBody = {}) => {
    lastGenerate.current = body;
    setFailedJob(null);
    setProviderMissing(false);
    setTrackedJob(job);
    reload();
  };

  const onJobDone = async (job: Job) => {
    finishedJobs.current.add(job.id);
    setTrackedJob(null);
    // A regeneration replaces the working copy (the editor was disabled while it ran).
    await editor.reloadLatest();
    reload();
    if (job.result?.valid === false) {
      setProblemsScroll((n) => n + 1);
    } else {
      const version = job.result?.script_version;
      message.success(version ? `Version ${version} is ready.` : 'Script ready');
    }
  };

  const onJobFailed = (job: Job) => {
    finishedJobs.current.add(job.id);
    setTrackedJob(null);
    setFailedJob(job);
    reload();
  };

  const onStartError = (error: unknown) => {
    if (isApiError(error) && error.code === 'provider_not_configured') {
      setProviderMissing(true);
      return true;
    }
    if (isApiError(error) && scriptErrorText(error.code)) {
      notification.error({
        title: scriptErrorText(error.code),
        description: error.request_id ? `Reference: ${error.request_id}` : undefined,
      });
      reload();
      return true;
    }
    return false;
  };

  const generateButton = (label: string, primary = true) => (
    <JobButton
      type={primary ? 'primary' : 'default'}
      start={() => generateScript(item.id, lastGenerate.current)}
      kinds={['script.generate']}
      onStarted={(job) => onJobStarted(job, lastGenerate.current)}
      onStartError={onStartError}
      disabled={!canStart || jobRunning}
      disabledReason={jobRunning ? jobReason : undefined}
      successMessage="Script ready"
    >
      {label}
    </JobButton>
  );

  // --- old version view -----------------------------------------------------------------------
  const [viewing, setViewing] = useState<ScriptVersionEntry | null>(null);
  const versionQuery = useQuery({
    queryKey: [accountId, 'script-version', item.id, viewing?.version],
    queryFn: () => getScriptVersion(item.id, viewing?.version as number),
    enabled: !!viewing,
  });
  const oldVersion = viewing ? (versionQuery.data ?? null) : null;
  const oldPackage = useMemo<EditorPackage | null>(
    () => (oldVersion ? derive(fromPayload(oldVersion.payload), ctx) : null),
    [oldVersion, ctx],
  );

  // --- dialogs --------------------------------------------------------------------------------
  const [saveOpen, setSaveOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conflict, setConflict] = useState<{ latest: number | null } | null>(null);
  const [extraProblems, setExtraProblems] = useState<string[]>([]);

  useEffect(() => {
    setExtraProblems([]);
  }, [resource?.version, handwritten]);

  const applyPayloadErrors = (fields: FieldError[]) => {
    const errors: Record<string, string[]> = {};
    const unmatched: string[] = [];
    for (const field of fields) {
      const path = stripPayload(field.path);
      const text = fieldErrorText(field);
      if (document.getElementById(fieldDomId(path))) {
        errors[path] = [...(errors[path] ?? []), text];
      } else {
        unmatched.push(`${fieldLabel(path, ctx.isImage)}: ${text}`);
      }
    }
    editor.setFieldErrors(errors);
    setExtraProblems(unmatched);
  };

  /** Shared handling for a refused save or restore; returns true when it was handled. */
  const handleWriteError = (error: unknown): boolean => {
    if (!isApiError(error)) return false;
    if (error.code === 'version_conflict') {
      setConflict({ latest: error.details.latest_version ?? null });
      return true;
    }
    if (error.code === 'job_in_progress' || error.code === 'invalid_transition') {
      notifyError(error);
      reload();
      editor.query.refetch();
      return true;
    }
    return false;
  };

  const handleSave = async (note: string): Promise<boolean> => {
    try {
      const saved = await editor.save(note);
      if (saved.unchanged) message.info(`Version ${saved.version} is already the current content.`);
      else message.success(`Saved as version ${saved.version}.`);
      reload();
      return true;
    } catch (error) {
      if (handleWriteError(error)) return true;
      if (isApiError(error) && error.code === 'validation_error') {
        const payloadFields = error.fields.filter((field) => field.path !== 'note');
        applyPayloadErrors(payloadFields);
        message.error(COPY.fieldsInvalid);
        // A note error stays in the dialog, under its field.
        if (payloadFields.length < error.fields.length) throw error;
        return true;
      }
      notifyError(error);
      return false;
    }
  };

  const approve = () => {
    if (!resource) return;
    Modal.confirm({
      title: `Approve version ${resource.version}? Production starts right away.`,
      okText: 'Approve script',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await editor.approve();
          message.success(COPY.approved);
          reload();
        } catch (error) {
          if (isApiError(error) && error.code === 'validation_error') {
            editor.showServerIssues(error.fields);
            setProblemsScroll((n) => n + 1);
          } else if (isApiError(error) && error.details.reason === 'brief_changed') {
            notification.error({ title: COPY.briefChanged });
            editor.query.refetch();
          } else if (!handleWriteError(error)) {
            notifyError(error);
          }
        }
      },
    });
  };

  const restore = async () => {
    if (!oldVersion) return;
    if (dirty && !(await confirmDiscard(COPY.leave, 'Discard changes'))) return;
    const n = oldVersion.version;
    const briefChanged = oldVersion.brief_version !== item.current_brief?.version;
    Modal.confirm({
      title: `Create version ${oldVersion.latest_version + 1} with the content of version ${n}? It will be a draft and needs approval.`,
      content: briefChanged
        ? `The brief has changed since version ${n} was written. Check that it still fits.`
        : undefined,
      okText: 'Restore',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const saved = await editor.restore(oldVersion);
          if (saved.unchanged) {
            message.info(`Version ${saved.version} is already the current content.`);
          } else {
            message.success(`Restored as version ${saved.version}.`);
          }
          setViewing(null);
          reload();
        } catch (error) {
          if (!handleWriteError(error)) notifyError(error);
        }
      },
    });
  };

  const discardHandwritten = async () => {
    if (await confirmDiscard(COPY.leave, 'Discard')) editor.discardHandwritten();
  };

  const writeByHand = () => {
    setProviderMissing(false);
    setFailedJob(null);
    editor.startHandwritten();
  };

  // --- render helpers -------------------------------------------------------------------------
  const historyDrawer = (
    <ScriptHistoryDrawer
      open={historyOpen}
      onClose={() => setHistoryOpen(false)}
      itemId={item.id}
      isImage={ctx.isImage}
      onSelect={(entry) => {
        setHistoryOpen(false);
        setViewing(entry.is_latest ? null : entry);
      }}
    />
  );

  const jobCard = trackedJob ? (
    <JobProgress
      job={trackedJob}
      jobId={trackedJob.id}
      onDone={onJobDone}
      onFailed={onJobFailed}
      failureText={failureText}
    />
  ) : null;

  const writeByHandButton = (
    <Tooltip title={jobRunning ? jobReason : undefined}>
      <Button onClick={writeByHand} disabled={!canStart || jobRunning}>
        Write script by hand
      </Button>
    </Tooltip>
  );

  const failureReference = (job: Job) => (
    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
      Reference: {job.request_id ?? job.id}
    </Typography.Text>
  );

  // --- states without an editor ---------------------------------------------------------------
  if (editor.query.isPending) return <LoadingCards />;
  if (editor.query.isError) {
    return <PageError error={editor.query.error} onRetry={() => editor.query.refetch()} />;
  }

  const hasEditor = !!resource || handwritten;

  if (!hasEditor) {
    let body: React.ReactNode;
    if (trackedJob) {
      body = null;
    } else if (locked) {
      body = (
        <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
          <Alert type="info" showIcon title={lockMessage} />
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This item has no script." />
        </Space>
      );
    } else if (!briefApproved) {
      body = (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={COPY.briefNotApproved}>
          <Button type="primary" onClick={() => switchTab('brief')}>
            Go to brief
          </Button>
        </Empty>
      );
    } else if (providerMissing) {
      body = (
        <Result status="warning" title={COPY.providerNotConfigured} extra={writeByHandButton} />
      );
    } else if (failedJob) {
      body = (
        <Result
          status="error"
          title={failureText(failedJob)}
          subTitle={failureReference(failedJob)}
          extra={
            <Space>
              {generateButton('Try again')}
              {writeByHandButton}
            </Space>
          }
        />
      );
    } else {
      body = (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={COPY.noScript}>
          <Space>
            {generateButton('Generate script')}
            {writeByHandButton}
          </Space>
        </Empty>
      );
    }
    return (
      <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
        {jobCard}
        {trackedJob ? (
          <div style={{ opacity: token.opacityLoading }}>
            <LoadingCards />
          </div>
        ) : (
          <ProCard>{body}</ProCard>
        )}
      </Space>
    );
  }

  // --- editor ---------------------------------------------------------------------------------
  const viewingOld = !!viewing;
  const canEdit = handwritten ? canStart : !!resource?.actions.can_edit;
  const readOnly = viewingOld || locked || jobRunning || !canEdit;
  const lockReason = jobRunning ? jobReason : lockMessage;
  const issuePaths = new Set(editor.issues.map((issue) => issue.path));
  const fieldState: FieldState = viewingOld
    ? { disabled: true, status: () => undefined, error: () => undefined }
    : {
        disabled: readOnly,
        lockReason,
        status: (path) =>
          editor.fieldErrors[path] ? 'error' : issuePaths.has(path) ? 'warning' : undefined,
        error: (path) => editor.fieldErrors[path]?.join(' '),
      };

  const approveBlock: React.ReactNode =
    (jobRunning && jobReason) ||
    lockMessage ||
    (dirty ? COPY.saveFirst : null) ||
    (editor.issues.length > 0 ? COPY.fixProblems : null) ||
    (resource && !resource.brief_is_current ? COPY.briefChanged : null);
  const approveDisabled = !!approveBlock || !resource?.actions.can_approve;
  const saveReason = (jobRunning && jobReason) || lockMessage;
  const saveDisabled = readOnly || !dirty;
  const regenerateReason = (jobRunning && jobReason) || lockMessage;
  const regenerateDisabled = !!regenerateReason || !resource?.actions.can_generate;

  const shown: ScriptResource | null = viewingOld ? oldVersion : resource;
  const pkg = viewingOld ? oldPackage : working;

  const header = (
    <ProCard
      title={
        <Space size={token.marginXS} wrap>
          {shown ? (
            <>
              <Typography.Text strong>{`Version ${shown.version}`}</Typography.Text>
              <StatusTag kind="script" status={shown.status} />
              <Tag>
                {shown.origin === 'ai'
                  ? 'AI'
                  : shown.created_by
                    ? `Edited by ${shown.created_by.name}`
                    : 'Edited'}
              </Tag>
              <Typography.Text type="secondary">{`written from brief v${shown.brief_version}`}</Typography.Text>
            </>
          ) : (
            <Typography.Text strong>
              {viewing ? `Version ${viewing.version}` : 'New script'}
            </Typography.Text>
          )}
          {dirty && !viewingOld ? <Tag color="warning">Unsaved changes</Tag> : null}
        </Space>
      }
      extra={
        <Space wrap>
          {resource ? (
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
              History
            </Button>
          ) : null}
          {viewingOld ? null : (
            <>
              {handwritten ? <Button onClick={discardHandwritten}>Discard</Button> : null}
              {resource ? (
                <Tooltip title={regenerateReason}>
                  <Button
                    icon={<ReloadOutlined />}
                    disabled={regenerateDisabled}
                    onClick={() => setRegenerateOpen(true)}
                  >
                    Regenerate
                  </Button>
                </Tooltip>
              ) : null}
              <Tooltip title={saveReason}>
                <Button
                  type={dirty ? 'primary' : 'default'}
                  disabled={saveDisabled}
                  onClick={() => setSaveOpen(true)}
                >
                  Save as new version
                </Button>
              </Tooltip>
              {resource ? (
                <Tooltip title={approveBlock}>
                  <Button
                    type={dirty ? 'default' : 'primary'}
                    disabled={approveDisabled}
                    onClick={approve}
                  >
                    Approve script
                  </Button>
                </Tooltip>
              ) : null}
            </>
          )}
        </Space>
      }
    />
  );

  const oldBanner =
    viewingOld && viewing ? (
      <div style={{ position: 'sticky', top: 0, zIndex: 2 }}>
        <Alert
          type="info"
          showIcon
          title={
            <>
              {`You are viewing version ${viewing.version} from `}
              <DateTime value={viewing.created_at} />
              {'. It is read-only.'}
            </>
          }
          action={
            <Space>
              <Tooltip
                title={(jobRunning && jobReason) || lockMessage || undefined}
              >
                <Button
                  size="small"
                  type="primary"
                  disabled={!oldVersion || jobRunning || locked || !resource?.actions.can_edit}
                  onClick={restore}
                >
                  Restore this version
                </Button>
              </Tooltip>
              <Button size="small" onClick={() => setViewing(null)}>
                Back to latest
              </Button>
            </Space>
          }
        />
      </div>
    ) : null;

  let content: React.ReactNode;
  if (viewingOld && versionQuery.isError) {
    content = <PageError error={versionQuery.error} onRetry={() => versionQuery.refetch()} />;
  } else if (!pkg) {
    content = <LoadingCards />;
  } else {
    const { actions } = editor;
    const issues = viewingOld ? (oldVersion?.validation?.issues ?? []) : editor.issues;
    content = (
      <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
        <ProblemsAlert
          ref={problemsRef}
          issues={issues}
          extra={viewingOld ? [] : extraProblems}
          isImage={ctx.isImage}
          linked={!readOnly}
        />
        <StoryCard
          pkg={pkg}
          rule={editor.rule}
          isImage={ctx.isImage}
          state={fieldState}
          onChange={actions.setStory}
        />
        {ctx.isImage ? null : (
          <ShotTable
            pkg={pkg}
            mode={ctx.mode}
            allowedTypes={editor.rule.allowed_shot_types}
            state={fieldState}
            onChange={actions.updateShot}
            onMove={actions.moveShot}
            onAdd={actions.addShot}
            onDelete={actions.deleteShot}
            onAddFrame={actions.addFrame}
          />
        )}
        <FrameCards
          pkg={pkg}
          templates={editor.templates}
          mode={ctx.mode}
          isImage={ctx.isImage}
          canvas={editor.canvas}
          state={fieldState}
          onChange={actions.updateFrame}
          onMove={actions.moveFrame}
          onDuplicate={actions.duplicateFrame}
          onDelete={actions.deleteFrame}
          onAdd={() => actions.addFrame()}
        />
        <DesignNotesCard
          notes={pkg.design_notes}
          state={fieldState}
          onChange={actions.setNote}
          onListChange={actions.setNoteList}
        />
      </Space>
    );
  }

  return (
    <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
      {jobCard}
      {failedJob && !trackedJob ? (
        <Alert
          type="error"
          showIcon
          title={failureText(failedJob)}
          description={failureReference(failedJob)}
          closable={{ 'aria-label': 'Dismiss' }}
          onClose={() => setFailedJob(null)}
          action={generateButton('Try again', false)}
        />
      ) : null}
      {oldBanner}
      {lockMessage ? <Alert type="info" showIcon title={lockMessage} /> : null}
      {!locked && !briefApproved && !viewingOld ? (
        <Alert
          type="info"
          showIcon
          title={COPY.briefNotApproved}
          action={
            <Button size="small" onClick={() => switchTab('brief')}>
              Go to brief
            </Button>
          }
        />
      ) : null}
      {header}
      <div style={jobRunning ? { opacity: token.opacityLoading } : undefined}>{content}</div>
      {historyDrawer}
      {resource ? (
        <RegenerateScriptModal
          open={regenerateOpen}
          onOpenChange={setRegenerateOpen}
          itemId={item.id}
          version={resource.version}
          dirty={dirty}
          onSaveNow={() => setSaveOpen(true)}
          onStarted={(job, body) => {
            setRegenerateOpen(false);
            onJobStarted(job, body);
          }}
          onReload={() => editor.reloadLatest()}
        />
      ) : null}
      <SaveScriptModal open={saveOpen} onOpenChange={setSaveOpen} onSave={handleSave} />
      <Modal
        open={!!conflict}
        title={
          conflict?.latest
            ? `Someone saved version ${conflict.latest} while you were editing.`
            : 'Someone saved a newer version while you were editing.'
        }
        onCancel={() => setConflict(null)}
        footer={[
          <Button key="keep" onClick={() => setConflict(null)}>
            Keep editing
          </Button>,
          <Button
            key="reload"
            type="primary"
            danger
            onClick={async () => {
              setConflict(null);
              await editor.reloadLatest();
              reload();
            }}
          >
            Reload latest (discard my changes)
          </Button>,
        ]}
      />
    </Space>
  );
};

export default ScriptTab;
