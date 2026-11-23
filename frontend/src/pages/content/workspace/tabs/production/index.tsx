import { ProCard } from '@ant-design/pro-components';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Button, Col, Empty, Flex, Row, Skeleton, theme } from 'antd';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import JobButton from '@/components/JobButton';
import PageError from '@/components/PageError';
import { useJob } from '@/hooks/useJob';
import { isActive, type JobSummary } from '@/services/socialhub/jobs';
import {
  getProduction,
  type Production,
} from '@/services/socialhub/production';
import { useAccountId } from '@/utils/accountRequest';
import type { WorkspaceTabProps } from '../../types';
import Alerts from './Alerts';
import CopyCard from './CopyCard';
import FootageCard from './FootageCard';
import FrameEditDrawer from './FrameEditDrawer';
import FramesCard from './FramesCard';
import MusicCoverCard from './MusicCoverCard';
import PreviewCard from './PreviewCard';
import {
  layoutFor,
  makeErrorHandler,
  PRODUCTION_JOB_KINDS,
  ProductionContext,
  type ProductionContextValue,
  productionFailureText,
  runningReasonFor,
  startJob,
} from './shared';
import TabHeader from './TabHeader';
import UploadFinalModal from './UploadFinalModal';

/** How often the resource is refreshed while a production job runs, for the steps indicator. */
const POLL_MS = 5000;

const LoadingState: React.FC = () => {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={token.margin} data-testid="production-loading">
      <ProCard size="small">
        <Skeleton active title={false} paragraph={{ rows: 1 }} />
      </ProCard>
      <Row gutter={[token.margin, token.margin]}>
        <Col xs={24} xl={10}>
          <ProCard>
            <Skeleton.Node active style={{ width: '100%', height: 420 }} />
          </ProCard>
        </Col>
        <Col xs={24} xl={14}>
          <Flex vertical gap={token.margin}>
            <ProCard>
              <Skeleton active paragraph={{ rows: 4 }} />
            </ProCard>
            <ProCard>
              <Skeleton active paragraph={{ rows: 6 }} />
            </ProCard>
          </Flex>
        </Col>
      </Row>
    </Flex>
  );
};

/** The Production tab of `/content/:id` (E06-S07). */
const ProductionTab: React.FC<WorkspaceTabProps> = ({
  item,
  reload,
  switchTab,
}) => {
  const { token } = theme.useToken();
  const accountId = useAccountId() ?? item.account;
  const queryClient = useQueryClient();
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [trackedJob, setTrackedJob] = useState<JobSummary | null>(null);
  const [ownedJobs, setOwnedJobs] = useState<Set<string>>(() => new Set());
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [editingFrame, setEditingFrame] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const urlRefetched = useRef(false);

  const reloadItem = useCallback(() => {
    void reload();
  }, [reload]);

  // A job started on this tab is followed here as well, so the tab knows when it ends even
  // before the shell's polling sees it.
  const { job: followed, isActive: trackedActive } = useJob(
    trackedJob?.id ?? null,
  );
  const itemJob =
    item.active_job && isActive(item.active_job.status)
      ? item.active_job
      : null;
  const localJob =
    trackedJob && trackedActive ? { ...trackedJob, ...(followed ?? {}) } : null;
  const activeJob: JobSummary | null = itemJob ?? localJob;
  const jobRunning = !!activeJob;
  const productionJob =
    !!activeJob &&
    (!activeJob.kind || PRODUCTION_JOB_KINDS.includes(activeJob.kind));

  const queryKey = useMemo(
    () => [accountId, 'production', item.id, viewVersion ?? 'current'],
    [accountId, item.id, viewVersion],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => getProduction(item.id, viewVersion ?? undefined),
    refetchInterval: productionJob ? POLL_MS : false,
    placeholderData: keepPreviousData,
  });

  const refetchAll = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: [accountId, 'production', item.id],
      }),
    [queryClient, accountId, item.id],
  );

  // The shell polls the item while a job runs; when the job ends, the resource is reloaded.
  const lastJobId = useRef<string | null>(activeJob?.id ?? null);
  useEffect(() => {
    const id = activeJob?.id ?? null;
    if (lastJobId.current && lastJobId.current !== id) {
      refetchAll();
      queryClient.invalidateQueries({ queryKey: [accountId, 'assets'] });
    }
    lastJobId.current = id;
  }, [activeJob?.id]);

  // A finished tracked job is dropped once the shell no longer reports it.
  useEffect(() => {
    if (trackedJob && !trackedActive && followed) setTrackedJob(null);
  }, [trackedActive, followed?.status]);

  const production = query.data;

  const ctx: ProductionContextValue | null = useMemo(() => {
    if (!production) return null;
    const adoptableJob =
      activeJob && !ownedJobs.has(activeJob.id) ? activeJob : null;
    return {
      item,
      production,
      accountId,
      refetch: refetchAll,
      setProduction: (next: Production) => {
        queryClient.setQueryData(
          [accountId, 'production', item.id, 'current'],
          next,
        );
      },
      reload: reloadItem,
      activeJob,
      adoptableJob,
      jobRunning,
      runningReason: runningReasonFor(activeJob),
      onJobStarted: (job: JobSummary, owned?: boolean) => {
        setTrackedJob(job);
        if (owned) setOwnedJobs((current) => new Set(current).add(job.id));
        reloadItem();
      },
      onJobEnded: () => {
        setTrackedJob(null);
      },
      handleError: makeErrorHandler(refetchAll, reloadItem),
      onUrlExpired: () => {
        if (urlRefetched.current) return;
        urlRefetched.current = true;
        refetchAll();
        window.setTimeout(() => {
          urlRefetched.current = false;
        }, 60_000);
      },
      layout: layoutFor(production.format),
      isCurrentDraft:
        production.is_current &&
        production.status === 'draft' &&
        production.version !== null,
    };
  }, [
    production,
    item,
    accountId,
    activeJob,
    jobRunning,
    ownedJobs,
    refetchAll,
    reloadItem,
    queryClient,
  ]);

  if (query.isLoading) return <LoadingState />;
  if (query.error || !production || !ctx) {
    return (
      <ProCard>
        <PageError error={query.error} onRetry={() => query.refetch()} />
      </ProCard>
    );
  }

  const modals = (
    <UploadFinalModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
  );

  if (production.version === null) {
    let empty: React.ReactNode;
    if (item.status === 'briefed') {
      empty = (
        <Empty description="Approve the script to start production, or use your own file.">
          <Flex gap={token.marginXS} justify="center" wrap>
            {production.actions.can_upload_final ? (
              <Button
                type="primary"
                onClick={() => setUploadOpen(true)}
                disabled={jobRunning}
              >
                Use my own file
              </Button>
            ) : null}
            <Button onClick={() => switchTab('script')}>Open the script</Button>
          </Flex>
        </Empty>
      );
    } else if (item.status === 'scripted' || production.actions.can_start) {
      empty = (
        <Empty description="Production has not started.">
          {production.actions.can_start || jobRunning ? (
            <JobButton
              type="primary"
              start={startJob(item.id, false)}
              activeJob={activeJob}
              kinds={['production.start']}
              onStarted={(job) => ctx.onJobStarted(job, true)}
              onDone={() => {
                setTrackedJob(null);
                refetchAll();
                reloadItem();
              }}
              onFailed={() => {
                setTrackedJob(null);
                refetchAll();
              }}
              onStartError={(error) => {
                ctx.handleError(error);
                return true;
              }}
              successMessage="Production finished"
              failureText={productionFailureText}
              runningReason={ctx.runningReason}
            >
              Start production
            </JobButton>
          ) : null}
        </Empty>
      );
    } else {
      empty = (
        <Empty description="Production starts after the script is approved." />
      );
    }
    return (
      <ProductionContext.Provider value={ctx}>
        <ProCard>{empty}</ProCard>
        {modals}
      </ProductionContext.Provider>
    );
  }

  const manual = production.origin === 'manual_upload';
  const mode = production.production_mode;
  const selected = manual ? null : selectedFrame;

  return (
    <ProductionContext.Provider value={ctx}>
      <Flex vertical gap={token.margin}>
        <TabHeader
          onSelectVersion={(version, isCurrent) => {
            setSelectedFrame(null);
            setViewVersion(isCurrent ? null : version);
          }}
          onOpenUpload={() => setUploadOpen(true)}
          switchTab={switchTab}
        />
        <Alerts
          onBackToCurrent={() => setViewVersion(null)}
          switchTab={switchTab}
        />
        <Row gutter={[token.margin, token.margin]}>
          <Col xs={24} xl={10}>
            <PreviewCard
              selectedFrame={selected}
              onShowFinal={() => setSelectedFrame(null)}
            />
          </Col>
          <Col xs={24} xl={14}>
            <Flex vertical gap={token.margin}>
              {mode === 'video' && !manual && production.shots.length > 0 ? (
                <FootageCard />
              ) : null}
              {!manual && production.frames.length > 0 ? (
                <FramesCard
                  selectedFrame={selected}
                  onSelect={setSelectedFrame}
                  onEdit={(index) => {
                    setSelectedFrame(index);
                    setEditingFrame(index);
                  }}
                />
              ) : null}
              {(mode === 'motion' || mode === 'video') && !manual ? (
                <MusicCoverCard />
              ) : null}
              <CopyCard />
            </Flex>
          </Col>
        </Row>
      </Flex>
      <FrameEditDrawer
        frameIndex={manual ? null : editingFrame}
        onClose={() => setEditingFrame(null)}
      />
      {modals}
    </ProductionContext.Provider>
  );
};

export default ProductionTab;
