import { WarningOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { history, Link } from '@umijs/max';
import {
  Alert,
  Button,
  Collapse,
  Empty,
  List,
  Modal,
  message,
  notification,
  Select,
  Skeleton,
  Space,
  Table,
  type TableColumnsType,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import { isApiError } from '@/services/socialhub/http';
import {
  confirmSelection,
  type Proposal,
  type ProposalSlot,
} from '@/services/socialhub/selection';
import { notifyError } from '@/utils/errorText';
import {
  candidateOptionLabel,
  computeFit,
  confirmErrorsBySlot,
  filledCount,
  initialRows,
  newIdempotencyKey,
  type ProposalRow,
  proposalCandidates,
  roleText,
  shortDate,
  toAssignments,
} from './logic';
import { FormatTag, type SelectionTabProps } from './shared';

export type ProposalTabProps = SelectionTabProps & {
  proposal: Proposal | undefined;
  loading: boolean;
  error: unknown;
  reloadProposal: () => void;
  onRank: () => void;
};

/** Fit tags for a chosen pair, computed in the panel (E03-S03 Panel). */
export const FitTags: React.FC<{
  slot: ProposalSlot;
  candidate: Parameters<typeof computeFit>[1] | null;
}> = ({ slot, candidate }) => {
  if (!candidate) return <Typography.Text type="secondary">—</Typography.Text>;
  const fit = computeFit(slot, candidate);
  return (
    <Space size={4} wrap>
      {fit.formatMatch ? (
        <Tag>Format match</Tag>
      ) : (
        <Tag color="warning" icon={<WarningOutlined />}>
          Format differs
        </Tag>
      )}
      {fit.roleMatch === null ? null : fit.roleMatch ? (
        <Tag>Role match</Tag>
      ) : (
        <Tag>Role differs</Tag>
      )}
    </Space>
  );
};

/** Proposal tab: match candidates to open slots and confirm (E03-S03). */
const ProposalTab: React.FC<ProposalTabProps> = ({
  account,
  plan,
  rankRunning,
  onChanged,
  goToTab,
  proposal,
  loading,
  error,
  reloadProposal,
  onRank,
}) => {
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState(false);
  /** One key per confirmation attempt; reused when the same request is retried (rule 19). */
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const readOnly = account.status === 'archived';

  useEffect(() => {
    if (proposal) {
      setRows(initialRows(proposal));
      setRowErrors({});
    }
  }, [proposal]);

  const candidates = useMemo(
    () => (proposal ? proposalCandidates(proposal) : []),
    [proposal],
  );
  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.id, c])),
    [candidates],
  );

  if (!plan) return null;
  if (error) {
    return (
      <ProCard>
        <PageError error={error} onRetry={reloadProposal} />
      </ProCard>
    );
  }
  if (loading || !proposal) {
    return (
      <ProCard>
        <Skeleton active />
      </ProCard>
    );
  }

  const chosen = new Set(
    rows.map((row) => row.candidateId).filter((id) => id !== null),
  );
  const filled = filledCount(rows);
  const totalSlots =
    proposal.assignments.length +
    proposal.unfilled_slots.length +
    proposal.reserved_slots.length;
  const neverRanked = proposal.ranked_at === null;
  const draft = plan.status === 'draft';

  const choose = (slotId: number, candidateId: number | null) => {
    setRows((current) =>
      current.map((row) =>
        row.slot.id === slotId ? { ...row, candidateId } : row,
      ),
    );
    setRowErrors(({ [slotId]: _, ...rest }) => rest);
  };

  const send = async () => {
    const assignments = toAssignments(rows);
    const body = { plan: plan.id, assignments };
    const text = JSON.stringify(body);
    if (!keyRef.current || keyRef.current.body !== text) {
      keyRef.current = { key: newIdempotencyKey(), body: text };
    }
    setConfirming(true);
    try {
      const response = await confirmSelection(body, keyRef.current.key);
      keyRef.current = null;
      const count = response.created.length;
      message.success({
        content: (
          <span>
            {count} content item{count === 1 ? '' : 's'} created.{' '}
            {/* `message` renders outside the router, so this navigates with `history`. */}
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 'auto' }}
              onClick={() => history.push(`/content?plan=${plan.id}`)}
            >
              Open content
            </Button>
          </span>
        ),
        duration: 6,
      });
      onChanged();
    } catch (err) {
      if (isApiError(err) && err.code === 'validation_error') {
        const bySlot = confirmErrorsBySlot(err.fields, assignments);
        if (Object.keys(bySlot).length) {
          setRowErrors(bySlot);
          message.error(
            'Some choices are no longer valid. Fix the marked rows.',
          );
        } else {
          notifyError(err);
        }
        keyRef.current = null;
      } else if (isApiError(err) && err.code === 'state_conflict') {
        notification.warning({
          title:
            'The selection changed while you were working. The latest proposal is shown.',
        });
        keyRef.current = null;
        reloadProposal();
        onChanged();
      } else {
        // Network or server failures keep the key, so pressing Confirm again is safe.
        notifyError(err);
      }
    } finally {
      setConfirming(false);
    }
  };

  const confirm = () => {
    Modal.confirm({
      title: `Create ${filled} content item${filled === 1 ? '' : 's'} for the week of ${shortDate(plan.week_start)}?`,
      content:
        'Their slots will be reserved and production will start with the briefs.',
      okText: 'Create items',
      cancelText: 'Cancel',
      onOk: send,
    });
  };

  const columns: TableColumnsType<ProposalRow> = [
    {
      title: 'Slot',
      key: 'slot',
      width: 200,
      render: (_, row) => (
        <DateTime value={row.slot.scheduled_at} format="datetime" />
      ),
    },
    {
      title: 'Format',
      key: 'format',
      width: 130,
      render: (_, row) => <FormatTag format={row.slot.format} />,
    },
    {
      title: 'Role',
      key: 'role',
      width: 110,
      render: (_, row) => roleText(row.slot.role, 'Any'),
    },
    {
      title: 'Candidate',
      key: 'candidate',
      render: (_, row) => {
        const problem = rowErrors[row.slot.id];
        return (
          <Space orientation="vertical" size={2} style={{ width: '100%' }}>
            <Select<number | 'none'>
              showSearch={{ optionFilterProp: 'label' }}
              aria-label={`Candidate for the slot on ${row.slot.scheduled_at}`}
              status={problem ? 'error' : undefined}
              style={{ width: '100%', minWidth: 280 }}
              disabled={readOnly || rankRunning}
              value={row.candidateId ?? 'none'}
              onChange={(value) =>
                choose(row.slot.id, value === 'none' ? null : value)
              }
              options={[
                { value: 'none', label: 'No candidate' },
                ...candidates.map((c) => ({
                  value: c.id,
                  label: candidateOptionLabel(c),
                  disabled: chosen.has(c.id) && c.id !== row.candidateId,
                  duplicate: Boolean(c.duplicate_of),
                })),
              ]}
              optionRender={(option) =>
                option.data.duplicate ? (
                  <Space size={4}>
                    <Tooltip title="Possible duplicate of recent content">
                      <WarningOutlined aria-label="Possible duplicate" />
                    </Tooltip>
                    {option.label}
                  </Space>
                ) : (
                  option.label
                )
              }
            />
            {problem ? (
              <Typography.Text type="danger">{problem}</Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: 'Fit',
      key: 'fit',
      width: 220,
      render: (_, row) => (
        <FitTags
          slot={row.slot}
          candidate={
            row.candidateId ? (byId.get(row.candidateId) ?? null) : null
          }
        />
      ),
    },
  ];

  let body: React.ReactNode;
  if (totalSlots === 0) {
    body = (
      <Empty description="This plan has no slots yet.">
        <Button
          type="primary"
          onClick={() => history.push(`/plans/${plan.id}?tab=slots`)}
        >
          Add slots
        </Button>
      </Empty>
    );
  } else if (neverRanked) {
    body = (
      <Empty description="No candidates yet. Run research or add feed items, then rank.">
        {readOnly ? null : (
          <Button type="primary" onClick={onRank} disabled={rankRunning}>
            Rank candidates
          </Button>
        )}
      </Empty>
    );
  } else if (rows.length === 0) {
    body = (
      <Alert
        type="info"
        showIcon
        title="Every slot in this plan has content."
      />
    );
  } else {
    let confirmBlock: React.ReactNode = null;
    if (draft) confirmBlock = 'Activate the plan to confirm the selection';
    else if (rankRunning) confirmBlock = 'Ranking is running';
    else if (filled === 0)
      confirmBlock = 'Choose a candidate for at least one slot';
    body = (
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
          <Typography.Text>
            {filled} of {rows.length} open slot{rows.length === 1 ? '' : 's'}{' '}
            filled
          </Typography.Text>
          <Space wrap>
            <Button
              disabled={rankRunning}
              onClick={() => {
                setRows(initialRows(proposal));
                setRowErrors({});
              }}
            >
              Reset to proposal
            </Button>
            {readOnly ? null : (
              <Tooltip title={confirmBlock}>
                <Button
                  type="primary"
                  loading={confirming}
                  disabled={Boolean(confirmBlock)}
                  onClick={confirm}
                >
                  Confirm selection ({filled})
                </Button>
              </Tooltip>
            )}
          </Space>
        </Space>
        <div
          style={{ opacity: rankRunning ? 0.6 : 1, transition: 'opacity 0.2s' }}
        >
          <Table<ProposalRow>
            rowKey={(row) => row.slot.id}
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 960 }}
            size="middle"
          />
        </div>
      </Space>
    );
  }

  return (
    <ProCard>
      <Space orientation="vertical" size={16} style={{ width: '100%' }}>
        {proposal.warnings.includes('slots_changed') ? (
          <Alert
            type="warning"
            showIcon
            title="Slots changed since the last ranking. Rank again to refresh the proposal."
          />
        ) : null}
        {body}
        {proposal.reserved_slots.length ? (
          <Collapse
            ghost
            items={[
              {
                key: 'reserved',
                label: `Already selected (${proposal.reserved_slots.length})`,
                children: (
                  <List
                    size="small"
                    dataSource={proposal.reserved_slots}
                    renderItem={(slot) => (
                      <List.Item>
                        <Space wrap size={8}>
                          <DateTime value={slot.scheduled_at} />
                          <FormatTag format={slot.format} />
                          {slot.content_item ? (
                            <>
                              <Link to={`/content/${slot.content_item.id}`}>
                                <ContentText>
                                  {slot.content_item.title}
                                </ContentText>
                              </Link>
                              <StatusTag
                                kind="item"
                                status={slot.content_item.status}
                              />
                            </>
                          ) : (
                            <StatusTag kind="slot" status={slot.status} />
                          )}
                        </Space>
                      </List.Item>
                    )}
                  />
                ),
              },
            ]}
          />
        ) : null}
        {proposal.unassigned_candidates.length &&
        !neverRanked &&
        rows.length ? (
          <Typography.Text type="secondary">
            {proposal.unassigned_candidates.length} more candidate
            {proposal.unassigned_candidates.length === 1 ? ' is' : 's are'}{' '}
            unassigned.{' '}
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => goToTab('candidates')}
            >
              See all candidates
            </Button>
          </Typography.Text>
        ) : null}
      </Space>
    </ProCard>
  );
};

export default ProposalTab;
