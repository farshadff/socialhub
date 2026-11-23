import { ExperimentOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Col,
  Flex,
  List,
  Row,
  Skeleton,
  Space,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useState } from 'react';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { useActiveJob } from '@/hooks/useJob';
import { aiProviderLabel } from '@/services/socialhub/ai';
import { isActive, type Job, type JobSummary } from '@/services/socialhub/jobs';
import {
  AI_TEST_KIND,
  type AiProviderStatus,
  type AiTestOutcome,
  type AiTestProvider,
  type AiTestResult,
  type DependencyState,
  getSystemStatus,
  type SystemStatus,
  startAiTest,
} from '@/services/socialhub/system';
import { ERROR_TEXT, JOB_ERROR_TEXT } from '@/utils/errorText';
import { DetailRows, formatSeconds } from './shared';

export const SYSTEM_STATUS_KEY = ['system', 'status'] as const;

const DEPENDENCY_STATES = new Set(['ok', 'unavailable', 'unknown']);

/** "OK" (success), "Unavailable" (error), "Unknown" (default): StatusTag kind `system`. */
const StateTag: React.FC<{
  state: DependencyState | string | null | undefined;
}> = ({ state }) => (
  <StatusTag
    kind="system"
    status={state && DEPENDENCY_STATES.has(state) ? state : 'unknown'}
  />
);

/** "Ready", or "Missing {setting names}". */
export const ReadyTag: React.FC<{ configured: boolean; missing: string[] }> = ({
  configured,
  missing,
}) =>
  configured ? (
    <StatusTag kind="system" status="ok" label="Ready" />
  ) : (
    <StatusTag
      kind="system"
      status="unavailable"
      label={
        missing.length ? `Missing ${missing.join(', ')}` : 'Not configured'
      }
    />
  );

const CONNECTION_PROVIDER_LABEL: Record<string, string> = {
  graph_api: 'Instagram API',
  manual: 'Manual (post by hand)',
  fake: 'Fake (local testing)',
};
const connectionProviderLabel = (value: string) =>
  CONNECTION_PROVIDER_LABEL[value] ?? value;

const STORAGE_LABEL: Record<string, string> = {
  local: 'Local disk',
  s3: 'S3-compatible',
};

const AI_TEST_PROVIDERS: { key: AiTestProvider }[] = [
  { key: 'text' },
  { key: 'image' },
];

const PROVIDER_ROWS: { key: 'text' | 'image'; label: string }[] = [
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Images' },
];

const NOT_REPORTED = (
  <Typography.Text type="secondary">Not reported yet.</Typography.Text>
);

/** One line per provider after the AI test: "Claude replied in 1.8 s", or the error. */
export function aiTestLine(outcome: AiTestOutcome): {
  ok: boolean;
  text: string;
  detail: string | null;
} {
  const name = aiProviderLabel(outcome.provider);
  if (outcome.ok) {
    return {
      ok: true,
      text: `${name} replied in ${formatSeconds(outcome.latency_ms)}`,
      detail: null,
    };
  }
  const code = outcome.error_code ?? '';
  return {
    ok: false,
    text: `${name} failed: ${ERROR_TEXT[code] ?? JOB_ERROR_TEXT[code] ?? 'The call failed.'}`,
    detail: outcome.error_detail,
  };
}

const AiTestResults: React.FC<{ result: AiTestResult }> = ({ result }) => {
  const rows = AI_TEST_PROVIDERS.flatMap(({ key }) => {
    const outcome = result[key];
    return outcome ? [{ key, ...aiTestLine(outcome) }] : [];
  });
  if (!rows.length) return null;
  return (
    <List
      size="small"
      bordered
      header={<Typography.Text strong>AI test result</Typography.Text>}
      dataSource={rows}
      renderItem={(row) => (
        <List.Item key={row.key}>
          <Flex vertical>
            <Typography.Text type={row.ok ? 'success' : 'danger'}>
              {row.text}
            </Typography.Text>
            {row.detail ? (
              <Typography.Text type="secondary">{row.detail}</Typography.Text>
            ) : null}
          </Flex>
        </List.Item>
      )}
    />
  );
};

const ProviderValue: React.FC<{ status: AiProviderStatus }> = ({ status }) => (
  <Space size={8} wrap>
    <Typography.Text>{aiProviderLabel(status.provider)}</Typography.Text>
    {status.model ? (
      <Typography.Text code>{status.model}</Typography.Text>
    ) : null}
    <ReadyTag configured={status.configured} missing={status.missing ?? []} />
  </Space>
);

/** AI providers card with "Run AI test" (E00-S05 Panel). */
const AiCard: React.FC<{ status: SystemStatus }> = ({ status }) => {
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const activeQuery = useActiveJob({
    account: 'none',
    kinds: [AI_TEST_KIND],
    targetType: 'system',
    targetId: 'ai',
  });
  const [tracked, setTracked] = useState<JobSummary | null>(null);
  const [result, setResult] = useState<AiTestResult | null>(null);

  useEffect(() => {
    if (activeQuery.data && isActive(activeQuery.data.status)) {
      setTracked(activeQuery.data);
    }
  }, [activeQuery.data?.id]);

  const reload = () => {
    setTracked(null);
    queryClient.invalidateQueries({ queryKey: SYSTEM_STATUS_KEY });
    queryClient.invalidateQueries({ queryKey: ['none', 'active-job'] });
  };
  const finished = (job: Job) => {
    if (job.result) setResult(job.result as AiTestResult);
    reload();
  };

  const priceless = status.ai.models_without_price ?? [];
  return (
    <ProCard
      title="AI providers"
      headerBordered
      extra={
        <JobButton
          type="primary"
          icon={<ExperimentOutlined />}
          kinds={[AI_TEST_KIND]}
          activeJob={tracked ?? activeQuery.data ?? null}
          start={() => startAiTest()}
          onStarted={(job) => {
            setResult(null);
            setTracked(job);
          }}
          onDone={finished}
          onFailed={reload}
          successMessage="AI test finished"
          runningReason="The AI test is running."
        >
          Run AI test
        </JobButton>
      }
    >
      <Flex vertical gap={token.margin}>
        <Typography.Text type="secondary">
          Makes one small call to each provider. Real providers charge for it.
        </Typography.Text>
        <DetailRows
          rows={PROVIDER_ROWS.map(({ key, label }) => ({
            label,
            children: <ProviderValue status={status.ai[key]} />,
          }))}
        />
        {priceless.length ? (
          <Alert
            type="warning"
            showIcon
            title={`No price is set for ${priceless.join(', ')}; their cost is recorded as 0.`}
          />
        ) : null}
        {tracked ? <JobProgress job={tracked} variant="inline" /> : null}
        {result ? <AiTestResults result={result} /> : null}
      </Flex>
    </ProCard>
  );
};

const ApplicationCard: React.FC<{ status: SystemStatus }> = ({ status }) => (
  <ProCard title="Application" headerBordered>
    <DetailRows
      rows={[
        { label: 'Version', children: status.app.version },
        { label: 'Environment', children: status.app.environment },
        {
          label: 'Database',
          children: <StateTag state={status.dependencies.database} />,
        },
        {
          label: 'Redis',
          children: <StateTag state={status.dependencies.redis} />,
        },
        {
          label: 'Workers',
          children: (
            <>
              <Space size={4} wrap>
                {(['default', 'render', 'publish'] as const).map((queue) => (
                  <Space key={queue} size={4}>
                    <Typography.Text type="secondary">
                      {queue.charAt(0).toUpperCase() + queue.slice(1)}
                    </Typography.Text>
                    <StateTag state={status.workers?.[queue]} />
                  </Space>
                ))}
              </Space>
            </>
          ),
        },
      ]}
    />
  </ProCard>
);

const InstagramCard: React.FC<{ status: SystemStatus }> = ({ status }) => {
  const ig = status.instagram;
  return (
    <ProCard title="Instagram" headerBordered>
      {ig ? (
        <DetailRows
          rows={[
            {
              label: 'Default connection type',
              children: connectionProviderLabel(ig.default_provider),
            },
            {
              label: 'Allowed types',
              children:
                ig.allowed_providers.map(connectionProviderLabel).join(', ') ||
                '—',
            },
            {
              label: 'Meta app',
              children: (
                <ReadyTag
                  configured={ig.meta_app.configured}
                  missing={ig.meta_app.missing ?? []}
                />
              ),
            },
            { label: 'App ID', children: ig.meta_app.app_id || '—' },
            {
              label: 'Redirect URI',
              children: ig.meta_app.redirect_uri ? (
                <Typography.Text copyable>
                  {ig.meta_app.redirect_uri}
                </Typography.Text>
              ) : (
                '—'
              ),
            },
            {
              label: 'Graph API version',
              children: ig.api_version || 'Not set',
            },
            { label: 'Egress proxy', children: ig.http_proxy ? 'Yes' : 'No' },
            {
              label: 'Token refresh',
              children: `Every ${ig.token_refresh_after_days.toLocaleString('en')} days`,
            },
            {
              label: 'Encryption key',
              children: ig.encryption_key_configured ? 'Configured' : 'Missing',
            },
          ]}
        />
      ) : (
        NOT_REPORTED
      )}
    </ProCard>
  );
};

const StorageCard: React.FC<{ status: SystemStatus }> = ({ status }) => {
  const storage = status.storage;
  return (
    <ProCard title="Storage" headerBordered>
      {storage ? (
        <DetailRows
          rows={[
            {
              label: 'Backend',
              children: STORAGE_LABEL[storage.backend] ?? storage.backend,
            },
            { label: 'Bucket', children: storage.bucket || '—' },
          ]}
        />
      ) : (
        NOT_REPORTED
      )}
    </ProCard>
  );
};

/** Status tab (E00-S05 FE1): four cards from `GET /system/status/`. */
const StatusTab: React.FC = () => {
  const { token } = theme.useToken();
  const query = useQuery({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: getSystemStatus,
  });
  if (query.isPending) {
    return (
      <Row gutter={[token.margin, token.margin]}>
        {[0, 1, 2, 3].map((key) => (
          <Col key={key} xs={24} xl={12}>
            <ProCard>
              <Skeleton active />
            </ProCard>
          </Col>
        ))}
      </Row>
    );
  }
  if (query.isError) {
    return <PageError error={query.error} onRetry={() => query.refetch()} />;
  }
  const status = query.data;
  return (
    <Row gutter={[token.margin, token.margin]}>
      <Col xs={24} xl={12}>
        <ApplicationCard status={status} />
      </Col>
      <Col xs={24} xl={12}>
        <AiCard status={status} />
      </Col>
      <Col xs={24} xl={12}>
        <InstagramCard status={status} />
      </Col>
      <Col xs={24} xl={12}>
        <StorageCard status={status} />
      </Col>
    </Row>
  );
};

export default StatusTab;
