import { ProCard } from '@ant-design/pro-components';
import { Flex, Typography, theme } from 'antd';
import React from 'react';
import FrameWarning from '@/pages/content/shared/FrameWarning';
import MediaPreview, {
  type MediaPreviewState,
} from '@/pages/content/shared/MediaPreview';
import {
  PRODUCTION_JOB_KINDS,
  runningStep,
  useProductionContext,
} from './shared';

export type PreviewCardProps = {
  selectedFrame: number | null;
  onShowFinal: () => void;
};

/** Left column: the final asset, or the selected frame, with the version's warnings. */
const PreviewCard: React.FC<PreviewCardProps> = ({
  selectedFrame,
  onShowFinal,
}) => {
  const { token } = theme.useToken();
  const { item, production, activeJob, onUrlExpired } = useProductionContext();
  const frame =
    selectedFrame !== null
      ? production.frames.find((f) => f.index === selectedFrame)
      : undefined;

  const productionJob =
    !!activeJob &&
    (!activeJob.kind || PRODUCTION_JOB_KINDS.includes(activeJob.kind));
  const step = runningStep(production);
  const rendering =
    production.render_status === 'rendering' ||
    (productionJob &&
      (activeJob?.kind === 'production.render' ||
        step === 'frames' ||
        step === 'assemble'));

  let state: MediaPreviewState = 'idle';
  if (frame) {
    if (frame.state === 'failed') state = 'failed';
    else if (!frame.asset) state = 'empty';
  } else if (rendering) {
    state = 'rendering';
  } else if (production.render_status === 'failed') {
    state = 'failed';
  } else if (!production.final_asset) {
    state = 'empty';
  }

  const frameText = frame
    ? [frame.headline, frame.body].filter(Boolean).join('. ')
    : '';
  const alt = frame
    ? frameText || `Frame ${frame.index}`
    : production.alt_text || production.caption || item.title;

  return (
    <ProCard
      title={frame ? `Frame ${frame.index}` : 'Preview'}
      extra={
        frame ? (
          <Typography.Link onClick={onShowFinal}>Show final</Typography.Link>
        ) : undefined
      }
    >
      <Flex vertical gap={token.margin} align="stretch">
        {frame ? (
          <MediaPreview
            key={`frame-${frame.index}`}
            asset={frame.asset ? { ...frame.asset, kind: 'image' } : null}
            format={production.format}
            mediaKind={production.media_kind}
            state={state}
            alt={alt}
            onUrlExpired={onUrlExpired}
          />
        ) : (
          <MediaPreview
            key="final"
            asset={production.final_asset}
            format={production.format}
            mediaKind={production.media_kind}
            cover={production.format === 'reel' ? production.cover_asset : null}
            state={state}
            alt={alt}
            usesAiGenerated={production.uses_ai_generated}
            onUrlExpired={onUrlExpired}
          />
        )}
        {frame ? (
          <FrameWarning warnings={frame.warnings} />
        ) : production.render_warnings.length > 0 ? (
          <Flex vertical gap={token.marginXS}>
            <Typography.Text strong>Warnings</Typography.Text>
            <FrameWarning warnings={production.render_warnings} showLocator />
          </Flex>
        ) : null}
      </Flex>
    </ProCard>
  );
};

export default PreviewCard;
