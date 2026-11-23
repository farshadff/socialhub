import { DownOutlined, PlusOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Button, Dropdown, Empty, Flex, message, Modal, Skeleton, Space, Typography } from 'antd';
import React, { useState } from 'react';
import PageError from '@/components/PageError';
import type { Account } from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import {
  deleteSlot,
  generateSlots,
  getSlotTemplate,
  listSlots,
  type Plan,
  type Slot,
  updateSlot,
} from '@/services/socialhub/plans';
import { notifyError } from '@/utils/errorText';
import { FILLED, localToday, planFieldText, slotSummaryLine } from '../shared';
import SlotModal from './SlotModal';
import SlotWeekGrid, { type SlotAction } from './SlotWeekGrid';
import TemplateDrawer from './TemplateDrawer';

export type SlotsTabProps = {
  plan: Plan;
  account: Account;
  /** Reload the plan (readiness and slot summary) after slot changes. */
  onChanged: () => void;
};

export const slotsKey = (accountId: number, planId: number) => [
  accountId,
  'plan',
  planId,
  'slots',
];

const SlotsTab: React.FC<SlotsTabProps> = ({ plan, account, onChanged }) => {
  const readOnly = plan.status === 'closed';
  const [editing, setEditing] = useState<Slot | null | undefined>(undefined);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateIntro, setTemplateIntro] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const slots = useQuery({
    queryKey: slotsKey(account.id, plan.id),
    queryFn: () => listSlots(plan.id),
  });
  const template = useQuery({
    queryKey: [account.id, 'slot-template'],
    queryFn: () => getSlotTemplate(account.id),
  });

  const refresh = () => {
    slots.refetch();
    onChanged();
  };

  const list = slots.data?.results ?? [];
  const live = list.filter((slot) => slot.status !== 'skipped');
  const byFormat = live.reduce<Record<string, number>>((acc, slot) => {
    acc[slot.format] = (acc[slot.format] ?? 0) + 1;
    return acc;
  }, {});
  const filled = live.filter((slot) => FILLED.includes(slot.status)).length;
  const openCount = list.filter((slot) => slot.status === 'open').length;
  const hasTemplate = (template.data?.rows ?? []).some((row) => row.active);

  const openTemplate = (intro: string | null = null) => {
    setTemplateIntro(intro);
    setTemplateOpen(true);
  };

  const generate = async (replace: boolean) => {
    if (!hasTemplate) {
      openTemplate('Set up the usual week first.');
      return;
    }
    setGenerating(true);
    try {
      const result = await generateSlots(plan.id, replace);
      const parts = [
        `${result.created} ${result.created === 1 ? 'slot' : 'slots'} created`,
        `${result.skipped} skipped`,
      ];
      if (replace) parts.push(`${result.deleted} replaced`);
      message.success(parts.join(', '));
      refresh();
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        const field = error.fields[0];
        if (field?.code === 'no_template') openTemplate('Set up the usual week first.');
        else message.error(field ? planFieldText(field, account) : 'Slots could not be generated.');
      } else {
        notifyError(error);
        if (isApiError(error) && error.status === 409) refresh();
      }
    } finally {
      setGenerating(false);
    }
  };

  const confirmReplace = () =>
    Modal.confirm({
      title: `Delete the ${openCount} open ${openCount === 1 ? 'slot' : 'slots'} and generate again?`,
      content: 'Reserved and scheduled slots are kept.',
      okText: 'Replace open slots',
      onOk: () => generate(true),
    });

  const onAction = async (slot: Slot, action: SlotAction) => {
    if (action === 'edit') {
      setEditing(slot);
      return;
    }
    if (action === 'delete') {
      Modal.confirm({
        title: `Delete the ${slot.local_time} slot on ${slot.local_date}?`,
        okText: 'Delete',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await deleteSlot(slot.id);
            message.success('Slot deleted');
          } catch (error) {
            notifyError(error);
          }
          refresh();
        },
      });
      return;
    }
    try {
      await updateSlot(slot.id, { status: action === 'skip' ? 'skipped' : 'open' });
      message.success(action === 'skip' ? 'Slot skipped' : 'Slot restored');
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error' && error.fields[0]) {
        message.error(planFieldText(error.fields[0], account, slot.format));
      } else {
        notifyError(error);
      }
    }
    refresh();
  };

  const toolbar = readOnly ? null : (
    <Space wrap>
      <Button icon={<PlusOutlined />} onClick={() => setEditing(null)}>
        Add slot
      </Button>
      <Dropdown.Button
        loading={generating}
        icon={<DownOutlined />}
        onClick={() => generate(false)}
        menu={{
          items: [{ key: 'replace', label: 'Replace open slots', disabled: openCount === 0 }],
          onClick: confirmReplace,
        }}
      >
        Generate from template
      </Dropdown.Button>
      <Button onClick={() => openTemplate()}>Edit template</Button>
    </Space>
  );

  let body: React.ReactNode;
  if (slots.isLoading) {
    body = <Skeleton active paragraph={{ rows: 6 }} />;
  } else if (slots.isError) {
    body = <PageError error={slots.error} onRetry={slots.refetch} />;
  } else if (list.length === 0) {
    body = (
      <Empty description="No slots yet. Generate them from the usual week or add one.">
        {!readOnly && (
          <Space>
            <Button type="primary" loading={generating} onClick={() => generate(false)}>
              Generate from template
            </Button>
            <Button onClick={() => setEditing(null)}>Add slot</Button>
          </Space>
        )}
      </Empty>
    );
  } else {
    body = (
      <SlotWeekGrid
        plan={plan}
        slots={list}
        today={localToday(account.timezone)}
        readOnly={readOnly}
        onAction={onAction}
      />
    );
  }

  return (
    <ProCard>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 16 }}>
        <Typography.Text>
          {slotSummaryLine({ total: live.length, by_format: byFormat }, filled)}
        </Typography.Text>
        {toolbar}
      </Flex>
      {body}
      <SlotModal
        plan={plan}
        account={account}
        slot={editing ?? null}
        open={editing !== undefined}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          message.success(editing ? 'Slot saved' : 'Slot added');
          refresh();
        }}
        onConflict={refresh}
      />
      <TemplateDrawer
        account={account}
        open={templateOpen}
        intro={templateIntro}
        onClose={() => setTemplateOpen(false)}
        onSaved={() => template.refetch()}
      />
    </ProCard>
  );
};

export default SlotsTab;
