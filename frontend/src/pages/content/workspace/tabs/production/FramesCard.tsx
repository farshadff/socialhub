import { EditOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import {
  Button,
  Flex,
  Grid,
  message,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useState } from 'react';
import FrameWarning from '@/pages/content/shared/FrameWarning';
import StatusTag, { sentenceCase } from '@/components/StatusTag';
import { useRenderTemplates } from '@/pages/content/shared/useRenderTemplates';
import {
  type ProductionFrame,
  updateProductionSettings,
} from '@/services/socialhub/production';
import { seconds, useProductionContext } from './shared';

/** Height of a frame thumbnail in the strip, and the width of a frame card. */
const THUMB_HEIGHT = 160;
const CARD_WIDTH = 156;

export type FramesCardProps = {
  selectedFrame: number | null;
  onSelect: (index: number) => void;
  onEdit: (index: number) => void;
};

/** "Frame 2 · Stat · 5 s" (no duration for design items, which have one still). */
export function frameCaption(
  frame: ProductionFrame,
  templateName: string,
  timed: boolean,
): string {
  return [
    `Frame ${frame.index}`,
    templateName,
    timed ? seconds(frame.duration_seconds) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The frame strip (E06-S07 FE3): state, warnings, "Edited here", selection and the reel cover star. */
const FramesCard: React.FC<FramesCardProps> = ({
  selectedFrame,
  onSelect,
  onEdit,
}) => {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const {
    item,
    production,
    setProduction,
    handleError,
    jobRunning,
    runningReason,
    layout,
  } = useProductionContext();
  const { byKey } = useRenderTemplates(production.format);
  const [savingCover, setSavingCover] = useState<number | null>(null);
  const timed = production.production_mode !== 'design';
  const isReel = production.format === 'reel';
  const canEdit = production.actions.can_edit_frames;
  const total = production.frames.reduce(
    (sum, frame) => sum + frame.duration_seconds,
    0,
  );
  const count = production.frames.length;
  const counter = `${count} ${count === 1 ? 'frame' : 'frames'}${timed ? ` · ${seconds(total)}` : ''}`;
  const aspect = layout === '4x5' ? '4 / 5' : '9 / 16';

  const chooseCover = async (index: number) => {
    if (production.version === null) return;
    setSavingCover(index);
    try {
      const next = await updateProductionSettings(item.id, {
        base_version: production.version,
        cover_frame_index: index,
      });
      setProduction(next);
      message.success(`Frame ${index} is the cover`);
    } catch (error) {
      handleError(error);
    } finally {
      setSavingCover(null);
    }
  };

  return (
    <ProCard
      title="Frames"
      extra={
        <Flex gap={token.marginSM} align="center">
          <Typography.Text type="secondary">{counter}</Typography.Text>
          {isReel ? (
            <Typography.Text type="secondary">
              <StarFilled aria-hidden style={{ color: token.colorWarning }} />{' '}
              cover
            </Typography.Text>
          ) : null}
        </Flex>
      }
    >
      <Flex
        gap={token.marginSM}
        wrap={screens.lg ? 'nowrap' : 'wrap'}
        style={{
          overflowX: screens.lg ? 'auto' : undefined,
          paddingBottom: token.paddingXXS,
        }}
        role="list"
        aria-label="Frames"
      >
        {production.frames.map((frame) => {
          const template = byKey.get(frame.template);
          const name = template?.name ?? sentenceCase(frame.template);
          const selected = frame.index === selectedFrame;
          const isCover = production.cover_frame_index === frame.index;
          const thumb = frame.asset?.thumbnail_url ?? frame.asset?.url ?? null;
          return (
            <Flex
              key={frame.index}
              role="listitem"
              vertical
              gap={token.marginXXS}
              style={{
                flex: 'none',
                width: CARD_WIDTH,
                padding: token.paddingXS,
                borderRadius: token.borderRadius,
                border: `${selected ? token.lineWidthBold : token.lineWidth}px ${token.lineType} ${
                  selected ? token.colorPrimary : token.colorBorderSecondary
                }`,
                background: token.colorBgContainer,
              }}
            >
              <button
                type="button"
                aria-pressed={selected}
                aria-label={`Show frame ${frame.index} in the preview`}
                title="Click to preview, double-click to edit"
                onClick={() => onSelect(frame.index)}
                onDoubleClick={() => onEdit(frame.index)}
                style={{
                  display: 'block',
                  alignSelf: 'center',
                  height: THUMB_HEIGHT,
                  aspectRatio: aspect,
                  padding: 0,
                  border: 'none',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  borderRadius: token.borderRadiusSM,
                  background: token.colorFillTertiary,
                  font: 'inherit',
                  color: token.colorTextSecondary,
                }}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                ) : (
                  <Flex
                    vertical
                    align="center"
                    justify="center"
                    style={{
                      width: '100%',
                      height: '100%',
                      border: `${token.lineWidth}px dashed ${token.colorBorder}`,
                      borderRadius: token.borderRadiusSM,
                    }}
                  >
                    {name}
                  </Flex>
                )}
              </button>
              <Typography.Text>
                {frameCaption(frame, name, timed)}
              </Typography.Text>
              <Flex gap={token.marginXXS} align="center" wrap>
                <StatusTag kind="frame" status={frame.state} />
                <FrameWarning warnings={frame.warnings} mode="icon" />
                {frame.overridden.length > 0 ? <Tag>Edited here</Tag> : null}
              </Flex>
              <Flex gap={token.marginXXS} align="center">
                <Tooltip title={jobRunning ? runningReason : undefined}>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => onEdit(frame.index)}
                    aria-label={`Edit frame ${frame.index}`}
                  >
                    {canEdit ? 'Edit' : 'View'}
                  </Button>
                </Tooltip>
                {isReel ? (
                  <Tooltip
                    title={
                      jobRunning
                        ? runningReason
                        : isCover
                          ? 'This frame is the cover'
                          : 'Use as cover'
                    }
                  >
                    <Button
                      size="small"
                      type="text"
                      aria-label={
                        isCover
                          ? `Frame ${frame.index} is the cover`
                          : `Use frame ${frame.index} as cover`
                      }
                      aria-pressed={isCover}
                      loading={savingCover === frame.index}
                      disabled={!canEdit || jobRunning || isCover}
                      onClick={() => chooseCover(frame.index)}
                      icon={
                        isCover ? (
                          <StarFilled style={{ color: token.colorWarning }} />
                        ) : (
                          <StarOutlined />
                        )
                      }
                    />
                  </Tooltip>
                ) : null}
              </Flex>
            </Flex>
          );
        })}
      </Flex>
    </ProCard>
  );
};

export default FramesCard;
