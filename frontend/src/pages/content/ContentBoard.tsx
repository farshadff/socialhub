import { history } from '@umijs/max';
import { Alert, Badge, Card, Empty, Space, Typography, theme } from 'antd';
import React from 'react';
import ContentText from '@/components/ContentText';
import DateTime from '@/components/DateTime';
import type {
  ContentItemSummary,
  ItemStatus as Status,
} from '@/services/socialhub/content';
import { BOARD_LIMIT, groupForBoard } from './logic';
import { ItemFormatTag, ItemStatus } from './parts';

const BoardCard: React.FC<{ item: ContentItemSummary }> = ({ item }) => {
  const { token } = theme.useToken();
  const open = () => history.push(`/content/${item.id}`);
  return (
    <Card
      size="small"
      hoverable
      role="link"
      tabIndex={0}
      aria-label={`Open ${item.title}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      style={{
        borderInlineStart: item.needs_attention
          ? `${token.lineWidthBold * 2}px solid ${token.colorWarning}`
          : undefined,
      }}
      styles={{ body: { padding: token.paddingSM } }}
    >
      <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        <ContentText strong ellipsis={2}>
          {item.title}
        </ContentText>
        <Space size={4} wrap>
          <ItemFormatTag format={item.format} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {item.slot ? (
              <DateTime value={item.slot.scheduled_at} />
            ) : (
              'No slot'
            )}
          </Typography.Text>
        </Space>
        <ItemStatus item={item} compact />
        {item.hold_reason ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {item.hold_reason}
          </Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
};

export type ContentBoardProps = {
  items: ContentItemSummary[];
  total: number;
  statusFilter: Status[];
};

/** Read-only board in workflow order (E03-S04 Panel). */
const ContentBoard: React.FC<ContentBoardProps> = ({
  items,
  total,
  statusFilter,
}) => {
  const { token } = theme.useToken();
  const groups = groupForBoard(items, statusFilter);
  return (
    <Space orientation="vertical" size={token.margin} style={{ width: '100%' }}>
      {total > BOARD_LIMIT ? (
        <Alert
          type="info"
          showIcon
          title={`Showing the first ${BOARD_LIMIT} items — narrow the filters`}
        />
      ) : null}
      <div
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: 'minmax(220px, 1fr)',
          gap: token.marginSM,
          overflowX: 'auto',
          paddingBottom: token.paddingXS,
        }}
      >
        {groups.map(({ column, items: cards }) => (
          <section
            key={column.key}
            aria-label={`${column.title}, ${cards.length} items`}
            style={{
              background: token.colorFillQuaternary,
              borderRadius: token.borderRadiusLG,
              padding: token.paddingXS,
              minHeight: 160,
            }}
          >
            <Space
              style={{
                width: '100%',
                justifyContent: 'space-between',
                padding: `${token.paddingXXS}px ${token.paddingXS}px ${token.paddingXS}px`,
              }}
            >
              <Typography.Text strong>{column.title}</Typography.Text>
              <Badge
                count={cards.length}
                showZero
                color={token.colorFillSecondary}
                style={{ color: token.colorText }}
              />
            </Space>
            <Space
              orientation="vertical"
              size={token.marginXS}
              style={{ width: '100%' }}
            >
              {cards.length ? (
                cards.map((item) => <BoardCard key={item.id} item={item} />)
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="Nothing here"
                />
              )}
            </Space>
          </section>
        ))}
      </div>
    </Space>
  );
};

export default ContentBoard;
