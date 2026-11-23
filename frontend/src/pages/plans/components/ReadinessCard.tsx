import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { Button, List, Space, Typography, theme } from 'antd';
import React from 'react';
import type { Readiness } from '@/services/socialhub/plans';
import { problemText, READINESS_LINES, type ReadinessLine } from '../shared';

export type ReadinessCardProps = {
  readiness: Readiness;
  onGo: (target: NonNullable<ReadinessLine['target']>) => void;
};

/** The activation checklist built from `readiness.problems` (E01-S01 rule 12). */
const ReadinessCard: React.FC<ReadinessCardProps> = ({ readiness, onGo }) => {
  const { token } = theme.useToken();
  return (
    <ProCard
      title="Readiness"
      headerBordered
      extra={
        <Typography.Text type={readiness.can_activate ? 'success' : 'secondary'}>
          {readiness.can_activate ? 'Ready to activate' : 'Not ready yet'}
        </Typography.Text>
      }
    >
      <List
        size="small"
        split={false}
        dataSource={READINESS_LINES}
        renderItem={(line) => {
          const problem = readiness.problems.find((item) => item.code === line.code);
          const target = line.target;
          return (
            <List.Item style={{ paddingInline: 0 }}>
              <Space align="start">
                {problem ? (
                  <CloseCircleFilled style={{ color: token.colorError }} aria-label="Missing" />
                ) : (
                  <CheckCircleFilled style={{ color: token.colorSuccess }} aria-label="Done" />
                )}
                <span>
                  {line.label}
                  {problem && (
                    <>
                      <br />
                      {target ? (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto' }}
                          onClick={() => onGo(target)}
                        >
                          {problemText(problem)}
                        </Button>
                      ) : (
                        <Typography.Text type="secondary">{problemText(problem)}</Typography.Text>
                      )}
                    </>
                  )}
                </span>
              </Space>
            </List.Item>
          );
        }}
      />
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: token.marginXS }}>
        Readiness reflects the last saved version of the plan.
      </Typography.Paragraph>
    </ProCard>
  );
};

export default ReadinessCard;
