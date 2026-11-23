import { useQuery } from '@tanstack/react-query';
import { Alert, Input, Modal, message, Table, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import { isApiError } from '@/services/socialhub/http';
import {
  listSignals,
  type TrendSignal,
  updateTopic,
} from '@/services/socialhub/research';
import { notifyError } from '@/utils/errorText';
import { KindTag } from './shared';

export const MAX_TOPIC_SIGNALS = 20;

export type AttachSignalsModalProps = {
  open: boolean;
  accountId: number;
  topicId: number;
  topicStatus: string;
  linkedIds: number[];
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
};

/** Pick the signals that support a topic; saving replaces the whole list (E02-S05 rule 6). */
const AttachSignalsModal: React.FC<AttachSignalsModalProps> = ({
  open,
  accountId,
  topicId,
  topicStatus,
  linkedIds,
  onClose,
  onSaved,
  onConflict,
}) => {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>(linkedIds);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(linkedIds);
      setQ('');
      setPage(1);
    }
  }, [open]);

  const query = useQuery({
    queryKey: [accountId, 'research-signals', 'attach', q, page],
    queryFn: () =>
      listSignals({
        account: accountId,
        q: q || undefined,
        page,
        page_size: 10,
      }),
    enabled: open,
  });

  const save = async () => {
    setSaving(true);
    try {
      await updateTopic(topicId, { signal_ids: selected });
      message.success('Topic saved');
      onSaved();
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'invalid_transition') {
        message.warning('This topic changed. Reloading.');
        onConflict();
        onClose();
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const full = selected.length >= MAX_TOPIC_SIGNALS;

  return (
    <Modal
      title="Attach signals"
      open={open}
      width={760}
      onCancel={onClose}
      onOk={save}
      okText="Save"
      cancelText="Cancel"
      confirmLoading={saving}
      destroyOnHidden
    >
      {topicStatus === 'new' ? (
        <Alert
          type="info"
          showIcon
          title="Saving also adds this topic to the shortlist."
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Input.Search
        aria-label="Search signals"
        placeholder="Search signals"
        allowClear
        onSearch={(value) => {
          setQ(value.trim());
          setPage(1);
        }}
        style={{ marginBottom: 12 }}
      />
      <Typography.Text type={full ? 'warning' : 'secondary'}>
        {selected.length} of {MAX_TOPIC_SIGNALS} selected
      </Typography.Text>
      {query.error ? (
        <PageError error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <Table<TrendSignal>
          rowKey="id"
          size="small"
          loading={query.isLoading}
          dataSource={query.data?.results ?? []}
          pagination={{
            current: page,
            pageSize: 10,
            total: query.data?.count ?? 0,
            onChange: setPage,
            showSizeChanger: false,
          }}
          rowSelection={{
            selectedRowKeys: selected,
            preserveSelectedRowKeys: true,
            onChange: (keys) =>
              setSelected(keys.map(Number).slice(0, MAX_TOPIC_SIGNALS)),
            getCheckboxProps: (row) => ({
              disabled: full && !selected.includes(row.id),
              'aria-label': `Select ${row.title}`,
            }),
          }}
          columns={[
            {
              title: 'Signal',
              dataIndex: 'title',
              render: (_, row) => (
                <ContentText ellipsis={2}>{row.title}</ContentText>
              ),
            },
            {
              title: 'Kind',
              dataIndex: 'kind',
              width: 130,
              render: (_, row) => <KindTag kind={row.kind} />,
            },
            {
              title: 'Captured',
              dataIndex: 'captured_at',
              width: 170,
              render: (_, row) => <DateTime value={row.captured_at} />,
            },
          ]}
        />
      )}
    </Modal>
  );
};

export default AttachSignalsModal;
