import { ReloadOutlined } from "@ant-design/icons";
import { useCustom } from "@refinedev/core";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Row,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { PageFrame } from "../../components/page-frame";

type HealthResponse = {
  status: string;
  dependencies?: Record<string, string>;
};

type DemoResponse = {
  mode: string;
  source_mode: string;
  account_timezone: string;
  source_provider: string;
  model_provider: string;
  publisher_provider: string;
  publishing_enabled: boolean;
  source_items: Array<{
    source_key: string;
    title: string;
    canonical_url: string;
    is_synthetic: boolean;
  }>;
  model_preview: { caption: string; is_synthetic: boolean };
};

const { Paragraph, Text, Link, Title } = Typography;

function ReadyTag({ ok }: { ok: boolean }) {
  return <Tag color={ok ? "success" : "error"}>{ok ? "Ready" : "Unavailable"}</Tag>;
}

/**
 * Local development overview: API readiness and the deterministic demo sample.
 * E11-S01 replaces it with the weekly overview.
 */
export function OverviewPage() {
  const queryOptions = { refetchInterval: 30_000 };
  const { query: health } = useCustom<HealthResponse>({
    url: "health/ready",
    method: "get",
    queryOptions,
    errorNotification: false,
  });
  const { query: demo } = useCustom<DemoResponse>({
    url: "demo",
    method: "get",
    queryOptions,
    errorNotification: false,
  });

  const healthData = health.data?.data;
  const demoData = demo.data?.data;
  const dependencies = healthData?.dependencies ?? {};
  const failed = health.error ?? demo.error;
  const loading = health.isLoading || demo.isLoading;
  const sample = demoData?.source_items[0];

  const statusCards = [
    { label: "API", ok: healthData?.status === "ready" },
    { label: "Database", ok: dependencies.database === "ok" },
    { label: "Redis", ok: dependencies.redis === "ok" },
  ];

  return (
    <PageFrame
      title="Overview"
      description="Local development environment"
      extra={
        <Button
          icon={<ReloadOutlined />}
          loading={health.isFetching || demo.isFetching}
          onClick={() => {
            health.refetch();
            demo.refetch();
          }}
        >
          Refresh
        </Button>
      }
    >
      <Flex vertical gap="middle">
        <Alert
          showIcon
          type="info"
          message="Local preview"
          description="This page uses synthetic fixture data. Source and model providers are local fixtures, and external publishing is disabled."
        />

        {failed && (
          <Alert
            showIcon
            type="error"
            message="Could not load Social Hub status"
            description={failed.message || "The API did not return a usable response."}
          />
        )}

        {loading ? (
          <Card>
            <Skeleton active />
          </Card>
        ) : (
          <>
            <Row gutter={[16, 16]}>
              {statusCards.map(({ label, ok }) => (
                <Col key={label} xs={24} sm={12} xl={6}>
                  <Card title={label} size="small">
                    <ReadyTag ok={ok} />
                  </Card>
                </Col>
              ))}
              <Col xs={24} sm={12} xl={6}>
                <Card title="External publishing" size="small">
                  <Tag>Disabled</Tag>
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} xl={12}>
                <Card title="Local providers" extra={<Tag color="processing">Read-only</Tag>}>
                  {demoData ? (
                    <Descriptions column={1}>
                      <Descriptions.Item label="Source provider">
                        <Text code>{demoData.source_provider}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Model provider">
                        <Text code>{demoData.model_provider}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="Publisher">
                        <Space>
                          <Text code>{demoData.publisher_provider}</Text>
                          <Tag>Disabled</Tag>
                        </Space>
                      </Descriptions.Item>
                      <Descriptions.Item label="Source mode">
                        {demoData.source_mode}
                      </Descriptions.Item>
                      <Descriptions.Item label="Account time zone">
                        <Text code>{demoData.account_timezone}</Text>
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Text type="secondary">
                      Provider details are unavailable until the API responds.
                    </Text>
                  )}
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card title="Synthetic sample item" extra={<Tag color="warning">Demo data</Tag>}>
                  {sample && demoData ? (
                    <Flex vertical gap="small">
                      <Title level={5} dir="auto" style={{ margin: 0 }}>
                        {sample.title}
                      </Title>
                      <Paragraph dir="auto" style={{ margin: 0 }}>
                        {demoData.model_preview.caption}
                      </Paragraph>
                      <Link href={sample.canonical_url} target="_blank" rel="noreferrer">
                        Open sample source
                      </Link>
                      <Text type="secondary">
                        {sample.is_synthetic
                          ? "Synthetic fixture; it cannot be published."
                          : "This item is not marked as synthetic."}
                      </Text>
                    </Flex>
                  ) : (
                    <Text type="secondary">The API has no sample item to show.</Text>
                  )}
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Flex>
    </PageFrame>
  );
}
