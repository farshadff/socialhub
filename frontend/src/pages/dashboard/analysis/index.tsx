import { ReloadOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { loadSocialHubOverview } from './service';

const { Paragraph, Text, Link } = Typography;

export default function SocialHubOverview() {
  const { data, error, isError, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['socialhub-overview'],
    queryFn: loadSocialHubOverview,
    refetchInterval: 30_000,
  });

  const ready = data?.health.status === 'ready';
  const dependencies = data?.health.dependencies ?? {};

  return (
    <PageContainer
      title="Social Hub overview"
      subTitle="Local development environment"
      extra={[
        <Button
          key="refresh"
          icon={<ReloadOutlined />}
          loading={isFetching}
          onClick={() => refetch()}
        >
          Refresh
        </Button>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        message="Local preview"
        description="This dashboard uses synthetic fixture data. Source and model providers are local fixtures, and external publishing is disabled."
        style={{ marginBottom: 24 }}
      />

      {isError && (
        <Alert
          showIcon
          type="error"
          message="Could not load Social Hub status"
          description={error instanceof Error ? error.message : 'The API did not return a usable response.'}
          style={{ marginBottom: 24 }}
        />
      )}

      {isLoading ? (
        <Card>
          <Spin tip="Connecting to the Social Hub API…" />
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} xl={6}>
              <Card>
                <Statistic
                  title="API"
                  value={ready ? 'Ready' : 'Unavailable'}
                  valueStyle={{ color: ready ? '#389e0d' : '#cf1322' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card>
                <Statistic
                  title="Database"
                  value={dependencies.database === 'ok' ? 'Ready' : 'Unavailable'}
                  valueStyle={{ color: dependencies.database === 'ok' ? '#389e0d' : '#cf1322' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card>
                <Statistic
                  title="Redis"
                  value={dependencies.redis === 'ok' ? 'Ready' : 'Unavailable'}
                  valueStyle={{ color: dependencies.redis === 'ok' ? '#389e0d' : '#cf1322' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card>
                <Statistic title="External publishing" value="Disabled" />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
            <Col xs={24} xl={12}>
              <Card title="Local providers" extra={<Tag color="blue">Read-only</Tag>}>
                {data ? (
                  <Descriptions column={1}>
                    <Descriptions.Item label="Source provider">
                      <Text code>{data.demo.source_provider}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Model provider">
                      <Text code>{data.demo.model_provider}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Publisher">
                      <Space>
                        <Text code>{data.demo.publisher_provider}</Text>
                        <Tag>Disabled</Tag>
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Source mode">{data.demo.source_mode}</Descriptions.Item>
                    <Descriptions.Item label="Account time zone">
                      <Text code>{data.demo.account_timezone}</Text>
                    </Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Text type="secondary">Provider details are unavailable until the API responds.</Text>
                )}
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="Synthetic sample item" extra={<Tag color="gold">Demo data</Tag>}>
                {data?.demo.source_items[0] ? (
                  <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                    <Typography.Title level={5} style={{ margin: 0 }}>
                      {data.demo.source_items[0].title}
                    </Typography.Title>
                    <Paragraph style={{ margin: 0 }}>{data.demo.model_preview.caption}</Paragraph>
                    <Link href={data.demo.source_items[0].canonical_url} target="_blank">
                      Open sample source
                    </Link>
                    <Text type="secondary">
                      {data.demo.source_items[0].is_synthetic
                        ? 'Synthetic fixture; it cannot be published.'
                        : 'This item is not marked as synthetic.'}
                    </Text>
                  </Space>
                ) : (
                  <Text type="secondary">The API has no sample item to show.</Text>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </PageContainer>
  );
}
