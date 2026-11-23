import {
  MobileOutlined,
  MoreOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Link } from '@umijs/max';
import { Button, Card, Dropdown, Flex, Grid, List, Space, Tag, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import dayjs from 'dayjs';
import React from 'react';
import StatusTag from '@/components/StatusTag';
import type { Format, Plan, Slot } from '@/services/socialhub/plans';
import { formatLabel, roleLabel, SLOT_PERMISSIONS } from '../shared';

const FORMAT_ICON: Record<Format, React.ReactNode> = {
  reel: <VideoCameraOutlined />,
  story: <MobileOutlined />,
  feed_post: <PictureOutlined />,
};

export type SlotAction = 'edit' | 'skip' | 'restore' | 'delete';

export type Day = { date: string; label: string; past: boolean; slots: Slot[] };

/** Seven days from the plan's week start (which is the account's first weekday). */
export function groupByDay(plan: Pick<Plan, 'week_start'>, slots: Slot[], today: string): Day[] {
  const start = dayjs(plan.week_start);
  return Array.from({ length: 7 }, (_, index) => {
    const date = start.add(index, 'day');
    const key = date.format('YYYY-MM-DD');
    return {
      date: key,
      label: date.format('ddd D MMM'),
      past: key < today,
      slots: slots
        .filter((slot) => slot.local_date === key)
        .sort((a, b) => a.local_time.localeCompare(b.local_time)),
    };
  });
}

export function slotActions(slot: Slot, readOnly: boolean): SlotAction[] {
  if (readOnly) return [];
  const can = SLOT_PERMISSIONS[slot.status];
  const actions: SlotAction[] = ['edit'];
  if (can.skip) actions.push(slot.status === 'skipped' ? 'restore' : 'skip');
  if (can.remove) actions.push('delete');
  return actions;
}

const ACTION_LABEL: Record<SlotAction, string> = {
  edit: 'Edit',
  skip: 'Skip',
  restore: 'Restore',
  delete: 'Delete',
};

type CardProps = {
  slot: Slot;
  now: string;
  readOnly: boolean;
  onAction: (slot: Slot, action: SlotAction) => void;
};

const SlotCard: React.FC<CardProps> = ({ slot, now, readOnly, onAction }) => {
  const { token } = theme.useToken();
  const actions = slotActions(slot, readOnly);
  const skipped = slot.status === 'skipped';
  const passed = slot.status === 'open' && slot.scheduled_at < now;
  const items: MenuProps['items'] = actions.map((action) => ({
    key: action,
    label: ACTION_LABEL[action],
    danger: action === 'delete',
  }));
  return (
    <Card
      size="small"
      style={{ opacity: skipped ? 0.55 : 1, borderRadius: token.borderRadius }}
      styles={{ body: { padding: token.paddingXS } }}
    >
      <Flex justify="space-between" align="start" gap={4}>
        <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
          <Typography.Text strong>{slot.local_time}</Typography.Text>
          <Space size={4} wrap>
            <Tag icon={FORMAT_ICON[slot.format]}>{formatLabel(slot.format)}</Tag>
            {slot.role && <Tag>{roleLabel(slot.role)}</Tag>}
          </Space>
          {skipped ? (
            <Typography.Text type="secondary">Skipped</Typography.Text>
          ) : (
            <StatusTag kind="slot" status={slot.status} />
          )}
          {slot.content_item && (
            <Space size={4} wrap>
              <Link to={`/content/${slot.content_item.id}`}>{slot.content_item.title}</Link>
              <StatusTag kind="item" status={slot.content_item.status} />
            </Space>
          )}
          {passed && <Typography.Text type="warning">Time has passed</Typography.Text>}
          {slot.note && (
            <Typography.Text type="secondary" ellipsis={{ tooltip: slot.note }} dir="auto">
              {slot.note}
            </Typography.Text>
          )}
        </Space>
        {actions.length > 0 && (
          <Dropdown
            trigger={['click']}
            menu={{ items, onClick: ({ key }) => onAction(slot, key as SlotAction) }}
          >
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined />}
              aria-label={`Actions for the ${slot.local_time} ${formatLabel(slot.format)} slot`}
            />
          </Dropdown>
        )}
      </Flex>
    </Card>
  );
};

export type SlotWeekGridProps = {
  plan: Plan;
  slots: Slot[];
  today: string;
  readOnly: boolean;
  onAction: (slot: Slot, action: SlotAction) => void;
};

/** Seven day columns at 1200 px and above; a list grouped by day below that. */
const SlotWeekGrid: React.FC<SlotWeekGridProps> = ({ plan, slots, today, readOnly, onAction }) => {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const days = groupByDay(plan, slots, today);
  const now = dayjs().utc().format('YYYY-MM-DDTHH:mm:ss[Z]');

  if (!screens.xl) {
    return (
      <List
        dataSource={days}
        renderItem={(day) => (
          <List.Item style={{ display: 'block', opacity: day.past ? 0.7 : 1 }}>
            <Typography.Title level={5}>{day.label}</Typography.Title>
            {day.slots.length === 0 ? (
              <Typography.Text type="secondary">No slots</Typography.Text>
            ) : (
              <Flex vertical gap={token.marginXS}>
                {day.slots.map((slot) => (
                  <SlotCard key={slot.id} slot={slot} now={now} readOnly={readOnly} onAction={onAction} />
                ))}
              </Flex>
            )}
          </List.Item>
        )}
      />
    );
  }

  return (
    <section
      aria-label="Slots for the week"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: token.marginXS }}
    >
      {days.map((day) => (
        <section
          aria-label={day.label}
          key={day.date}
          style={{
            opacity: day.past ? 0.7 : 1,
            background: token.colorFillQuaternary,
            borderRadius: token.borderRadius,
            padding: token.paddingXS,
            minHeight: 160,
          }}
        >
          <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
            {day.label}
          </Typography.Text>
          <Flex vertical gap={token.marginXS}>
            {day.slots.map((slot) => (
              <SlotCard key={slot.id} slot={slot} now={now} readOnly={readOnly} onAction={onAction} />
            ))}
          </Flex>
        </section>
      ))}
    </section>
  );
};

export default SlotWeekGrid;
