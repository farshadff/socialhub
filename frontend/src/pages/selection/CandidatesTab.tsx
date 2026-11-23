import { WarningOutlined } from '@ant-design/icons';
import {
  type ActionType,
  ProCard,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { Link } from '@umijs/max';
import {
  Button,
  Empty,
  message,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useMemo, useRef, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import StatusTag from '@/components/StatusTag';
import {
  type Candidate,
  type CandidateKind,
  type CandidateStatus,
  listCandidates,
  type Proposal,
  updateCandidate,
} from '@/services/socialhub/selection';
import { notifyError } from '@/utils/errorText';
import {
  FORMAT_LABEL,
  KIND_LABEL,
  roleText,
  scoreText,
  subScoresText,
} from './logic';
import {
  ExternalLink,
  FormatTag,
  KindTag,
  type SelectionTabProps,
  toPageParams,
  useReloadOnChange,
} from './shared';

const DEFAULT_STATUSES: CandidateStatus[] = ['candidate', 'proposed'];

const STATUS_OPTIONS: { value: CandidateStatus; label: string }[] = [
  { value: 'candidate', label: 'Candidate' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'selected', label: 'Selected' },
  { value: 'rejected', label: 'Rejected' },
];

const KIND_OPTIONS = (Object.keys(KIND_LABEL) as CandidateKind[]).map(
  (kind) => ({
    value: kind,
    label: KIND_LABEL[kind],
  }),
);

export type CandidatesTabProps = SelectionTabProps & {
  proposal: Proposal | undefined;
  onRank: () => void;
};

/** Expanded row: summary, rationale and sources (E03-S03 Panel). */
export const CandidateDetails: React.FC<{ candidate: Candidate }> = ({
  candidate,
}) => (
  <Space orientation="vertical" size={8} style={{ maxWidth: 880 }}>
    {candidate.summary ? (
      <div>
        <Typography.Text type="secondary">Summary</Typography.Text>
        <ContentText as="p" preserveLineBreaks>
          {candidate.summary}
        </ContentText>
      </div>
    ) : null}
    {candidate.rationale ? (
      <div>
        <Typography.Text type="secondary">
          Why it scored this way
        </Typography.Text>
        <ContentText as="p">{candidate.rationale}</ContentText>
      </div>
    ) : null}
    {candidate.sources.length ? (
      <div>
        <Typography.Text type="secondary">Sources</Typography.Text>
        <ul style={{ margin: 0, paddingInlineStart: 20 }}>
          {candidate.sources.map((source) => (
            <li key={source.url}>
              <ExternalLink href={source.url}>
                <ContentText>{source.title || source.url}</ContentText>
              </ExternalLink>
            </li>
          ))}
        </ul>
      </div>
    ) : null}
  </Space>
);

/** Candidates tab (E03-S03). */
const CandidatesTab: React.FC<CandidatesTabProps> = ({
  account,
  plan,
  refreshKey,
  rankRunning,
  onChanged,
  proposal,
  onRank,
}) => {
  const actionRef = useRef<ActionType>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [statuses, setStatuses] = useState<CandidateStatus[]>(DEFAULT_STATUSES);
  const [kinds, setKinds] = useState<CandidateKind[]>([]);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const readOnly = account.status === 'archived';
  useReloadOnChange(actionRef, refreshKey);

  /** Content item behind each reserved slot, for "Open item" on selected candidates. */
  const itemBySlot = useMemo(() => {
    const map: Record<number, number> = {};
    for (const slot of proposal?.reserved_slots ?? []) {
      if (slot.content_item) map[slot.id] = slot.content_item.id;
    }
    return map;
  }, [proposal]);

  const setStatus = async (
    candidate: Candidate,
    to: 'rejected' | 'candidate',
  ) => {
    setPending((map) => ({ ...map, [candidate.id]: true }));
    try {
      await updateCandidate(candidate.id, { status: to });
      message.success(
        to === 'rejected' ? 'Candidate rejected' : 'Candidate restored',
      );
      actionRef.current?.reload();
      onChanged();
    } catch (err) {
      notifyError(err);
      actionRef.current?.reload();
    } finally {
      setPending(({ [candidate.id]: _, ...rest }) => rest);
    }
  };

  const busyTip = (node: React.ReactNode, key: string) =>
    rankRunning ? (
      <Tooltip key={key} title="Ranking is running">
        <span>{node}</span>
      </Tooltip>
    ) : (
      <React.Fragment key={key}>{node}</React.Fragment>
    );

  const columns: ProColumns<Candidate>[] = [
    {
      title: 'Rank',
      dataIndex: 'rank',
      width: 70,
      render: (_, row) => (row.rank === null ? '—' : row.rank),
    },
    {
      title: 'Candidate',
      dataIndex: 'title',
      render: (_, row) => (
        <Space orientation="vertical" size={4}>
          <ContentText strong>{row.title}</ContentText>
          <Space size={4} wrap>
            <KindTag kind={row.kind} />
            {row.duplicate_of ? (
              <Link to={`/content/${row.duplicate_of.id}`}>
                <Tag color="warning" icon={<WarningOutlined />}>
                  Possible duplicate
                </Tag>
              </Link>
            ) : null}
          </Space>
        </Space>
      ),
    },
    {
      title: 'Formats',
      dataIndex: 'suggested_formats',
      width: 170,
      render: (_, row) =>
        row.suggested_formats.length ? (
          <Space size={4} wrap>
            {row.suggested_formats.map((format) => (
              <FormatTag key={format} format={format} />
            ))}
          </Space>
        ) : (
          'Any'
        ),
    },
    {
      title: 'Role',
      dataIndex: 'suggested_role',
      width: 110,
      render: (_, row) => roleText(row.suggested_role),
    },
    {
      title: 'Score',
      dataIndex: 'total_score',
      width: 220,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{scoreText(row.total_score)}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {subScoresText(row)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (_, row) => <StatusTag kind="candidate" status={row.status} />,
    },
    {
      title: 'Slot',
      dataIndex: 'proposed_slot',
      width: 180,
      render: (_, row) =>
        row.proposed_slot ? (
          <Space orientation="vertical" size={0}>
            <DateTime value={row.proposed_slot.scheduled_at} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {FORMAT_LABEL[row.proposed_slot.format]}
            </Typography.Text>
          </Space>
        ) : (
          '—'
        ),
    },
    {
      title: 'Actions',
      valueType: 'option',
      width: 110,
      render: (_, row) => {
        if (row.status === 'selected') {
          const itemId = row.proposed_slot
            ? itemBySlot[row.proposed_slot.id]
            : undefined;
          return itemId
            ? [
                <Link key="open" to={`/content/${itemId}`}>
                  Open item
                </Link>,
              ]
            : [];
        }
        if (readOnly) return [];
        if (row.status === 'rejected') {
          return [
            busyTip(
              <Button
                type="link"
                size="small"
                disabled={rankRunning}
                loading={pending[row.id]}
                onClick={() => setStatus(row, 'candidate')}
              >
                Restore
              </Button>,
              'restore',
            ),
          ];
        }
        return [
          busyTip(
            <Popconfirm
              title="Reject this candidate?"
              okText="Reject"
              cancelText="Cancel"
              disabled={rankRunning}
              onConfirm={() => setStatus(row, 'rejected')}
            >
              <Button
                type="link"
                size="small"
                danger
                disabled={rankRunning}
                loading={pending[row.id]}
              >
                Reject
              </Button>
            </Popconfirm>,
            'reject',
          ),
        ];
      },
    },
  ];

  if (!plan) return null;
  if (error) {
    return (
      <ProCard>
        <PageError error={error} onRetry={() => setError(null)} />
      </ProCard>
    );
  }

  const neverRanked = proposal ? proposal.ranked_at === null : false;
  const filtered =
    kinds.length > 0 ||
    duplicatesOnly ||
    statuses.join() !== DEFAULT_STATUSES.join();

  return (
    <ProCard>
      <div
        style={{ opacity: rankRunning ? 0.6 : 1, transition: 'opacity 0.2s' }}
      >
        <ProTable<Candidate>
          rowKey="id"
          actionRef={actionRef}
          columns={columns}
          search={false}
          options={false}
          params={{ plan: plan.id, statuses, kinds, duplicatesOnly }}
          pagination={{ defaultPageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1100 }}
          expandable={{
            rowExpandable: (row) =>
              Boolean(row.summary || row.rationale || row.sources.length),
            expandedRowRender: (row) => <CandidateDetails candidate={row} />,
          }}
          request={async (params) => {
            try {
              const page = await listCandidates({
                account: account.id,
                plan: plan.id,
                ...toPageParams(params),
                status: statuses.length ? statuses : undefined,
                kind: kinds.length ? kinds : undefined,
                duplicate: duplicatesOnly ? true : undefined,
              });
              return { data: page.results, total: page.count, success: true };
            } catch (err) {
              setError(err);
              return { data: [], total: 0, success: false };
            }
          }}
          locale={{
            emptyText:
              neverRanked && !filtered ? (
                <Empty description="No candidates yet. Run research or add feed items, then rank.">
                  {readOnly ? null : (
                    <Button
                      type="primary"
                      onClick={onRank}
                      disabled={rankRunning}
                    >
                      Rank candidates
                    </Button>
                  )}
                </Empty>
              ) : (
                <Empty description="No candidates match these filters." />
              ),
          }}
          toolBarRender={() => [
            <Select<CandidateKind[]>
              key="kind"
              mode="multiple"
              aria-label="Kind"
              placeholder="Any kind"
              style={{ minWidth: 160 }}
              value={kinds}
              onChange={setKinds}
              options={KIND_OPTIONS}
            />,
            <Select<CandidateStatus[]>
              key="status"
              mode="multiple"
              aria-label="Status"
              placeholder="Any status"
              style={{ minWidth: 220 }}
              value={statuses}
              onChange={setStatuses}
              options={STATUS_OPTIONS}
            />,
            <Space key="duplicates" size={8}>
              <Switch
                size="small"
                id="duplicates-only"
                checked={duplicatesOnly}
                onChange={setDuplicatesOnly}
              />
              <label htmlFor="duplicates-only">Duplicates only</label>
            </Space>,
          ]}
        />
      </div>
    </ProCard>
  );
};

export default CandidatesTab;
