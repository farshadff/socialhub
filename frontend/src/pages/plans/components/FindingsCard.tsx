import { ProCard } from '@ant-design/pro-components';
import { Button, List, Space, Tag, Typography } from 'antd';
import React from 'react';
import ContentText from '@/components/ContentText';
import type { CarriedFinding, FindingState } from '@/services/socialhub/plans';
import { FINDING_TYPE } from '../shared';

export type FindingsCardProps = {
  findings: CarriedFinding[];
  states: Record<string, FindingState>;
  disabled: boolean;
  onApply: (finding: CarriedFinding) => void;
  onIgnore: (finding: CarriedFinding) => void;
  onUndo: (finding: CarriedFinding) => void;
};

/** Findings carried over from last week's report (E01-S01; data from E10-S03). */
const FindingsCard: React.FC<FindingsCardProps> = ({
  findings,
  states,
  disabled,
  onApply,
  onIgnore,
  onUndo,
}) => {
  if (findings.length === 0) return null;
  return (
    <div id="carried-findings" tabIndex={-1}>
      <ProCard title="Findings from last week" headerBordered>
        <List
        dataSource={findings}
        renderItem={(finding) => {
          const state = states[finding.id] ?? finding.state;
          const type = FINDING_TYPE[finding.type] ?? FINDING_TYPE.insight;
          if (state !== 'pending') {
            return (
              <List.Item
                actions={
                  disabled
                    ? []
                    : [
                        <Button key="undo" type="link" size="small" onClick={() => onUndo(finding)}>
                          Undo
                        </Button>,
                      ]
                }
              >
                <Space>
                  <Tag color={state === 'applied' ? 'success' : 'default'}>
                    {state === 'applied' ? 'Applied' : 'Ignored'}
                  </Tag>
                  <ContentText>{finding.title}</ContentText>
                </Space>
              </List.Item>
            );
          }
          return (
            <List.Item
              actions={
                disabled
                  ? []
                  : [
                      <Button key="apply" size="small" onClick={() => onApply(finding)}>
                        Apply
                      </Button>,
                      <Button key="ignore" size="small" onClick={() => onIgnore(finding)}>
                        Ignore
                      </Button>,
                    ]
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={type.color}>{type.label}</Tag>
                    <ContentText>{finding.title}</ContentText>
                  </Space>
                }
                description={
                  <>
                    {finding.detail && <ContentText as="p">{finding.detail}</ContentText>}
                    {finding.recommendation && (
                      <Typography.Paragraph style={{ marginBottom: 0 }}>
                        <Typography.Text strong>Recommendation: </Typography.Text>
                        <ContentText>{finding.recommendation}</ContentText>
                      </Typography.Paragraph>
                    )}
                  </>
                }
              />
            </List.Item>
          );
        }}
        />
      </ProCard>
    </div>
  );
};

export default FindingsCard;
