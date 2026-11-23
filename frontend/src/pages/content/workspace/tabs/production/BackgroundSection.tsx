import { PictureOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Flex,
  Input,
  message,
  notification,
  Popover,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useState } from 'react';
import AssetPicker from '@/pages/content/shared/AssetPicker';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import RightsTag from '@/pages/content/shared/RightsTag';
import { type Asset, listAssets } from '@/services/socialhub/assets';
import { isApiError } from '@/services/socialhub/http';
import type { Job, JobSummary } from '@/services/socialhub/jobs';
import {
  type BackgroundAssetRef,
  generateFrameImage,
  type ProductionFrame,
  type RenderTemplate,
} from '@/services/socialhub/production';
import { getScriptVersion } from '@/services/socialhub/scripts';
import { ERROR_TEXT } from '@/utils/errorText';
import { Counter, charCount, useProductionContext } from './shared';

/** `SOCIALHUB_AI_MAX_IMAGES_PER_ITEM` default (E06-S05 rule 4). The API's 429 is the real gate. */
export const GENERATED_IMAGE_CAP = 12;
export const PROMPT_MAX = 600;
const EARLIER_LIMIT = 6;
const THUMB_HEIGHT = 120;

export const CAP_REACHED_TEXT =
  'The limit of generated images for this item is reached.';
const NOT_CONFIGURED_TEXT =
  'Image generation is not set up. Ask an admin to add the OpenAI key.';

/** Failure text for a `production.generate_image` job (E06-S05 messages). */
export function generateFailureText(
  job: Pick<Job, 'error_code' | 'error_detail'>,
): string {
  if (job.error_code === 'provider_error' && job.error_detail === 'refused') {
    return 'The image provider declined this description. Edit it or choose an image from the library.';
  }
  if (job.error_code === 'provider_error')
    return 'The image could not be generated. Try again in a moment.';
  if (job.error_code === 'provider_not_configured') return NOT_CONFIGURED_TEXT;
  if (job.error_code === 'rate_limited') return CAP_REACHED_TEXT;
  return 'The image could not be generated. Try again in a moment.';
}

/** "Style: clean editorial photography. Mood: calm, optimistic. No text in the image." */
export function styleLine(
  notes: { imagery_style?: string; mood?: string } | undefined,
): string {
  const clean = (value?: string) => (value ?? '').trim().replace(/[.\s]+$/, '');
  const parts: string[] = [];
  if (clean(notes?.imagery_style))
    parts.push(`Style: ${clean(notes?.imagery_style)}.`);
  if (clean(notes?.mood)) parts.push(`Mood: ${clean(notes?.mood)}.`);
  parts.push('No text in the image.');
  return parts.join(' ');
}

export function toBackgroundRef(asset: Asset): BackgroundAssetRef {
  return {
    id: asset.id,
    thumbnail_url: asset.thumbnail_url,
    origin: asset.origin,
    rights_status: asset.rights_status,
    url: asset.url,
    license_note: asset.license_note,
    rights_expires_at: asset.rights_expires_at,
  };
}

export type BackgroundSectionProps = {
  frame: ProductionFrame;
  template: RenderTemplate | undefined;
  /** The background shown: the drawer's unsaved choice, or the frame's. */
  current: BackgroundAssetRef | null;
  /** A new choice (null removes the background). */
  onChange: (next: BackgroundAssetRef | null) => void;
  /** Called after a generated image was attached by the server. */
  onGenerated: () => void;
  disabled: boolean;
};

/** Background controls of the frame drawer (E06-S07) with image generation (E06-S05). */
const BackgroundSection: React.FC<BackgroundSectionProps> = ({
  frame,
  template,
  current,
  onChange,
  onGenerated,
  disabled,
}) => {
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const {
    item,
    production,
    accountId,
    layout,
    onJobStarted,
    handleError,
    refetch,
  } = useProductionContext();
  const [picking, setPicking] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [prompt, setPrompt] = useState(frame.visual_prompt ?? '');
  const [genJob, setGenJob] = useState<JobSummary | null>(null);

  const usesImage = !!template && template.image_slot !== 'none';
  const generatedParams = {
    account: accountId,
    content_item: item.id,
    origin: ['ai_generated' as const],
    role: ['background' as const],
    page_size: 50,
  };
  const generated = useQuery({
    queryKey: [accountId, 'assets', generatedParams],
    queryFn: () => listAssets(generatedParams),
    enabled: usesImage,
  });
  const scriptVersion = production.script?.version;
  const script = useQuery({
    queryKey: [accountId, 'script-version', item.id, scriptVersion],
    queryFn: () => getScriptVersion(item.id, scriptVersion as number),
    enabled: usesImage && popoverOpen && !!scriptVersion,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (!template) return null;
  if (!usesImage) {
    return (
      <Typography.Text type="secondary">
        This template does not use an image.
      </Typography.Text>
    );
  }

  const usedCount = generated.data?.count ?? 0;
  const atCap = usedCount >= GENERATED_IMAGE_CAP;
  const earlier = (generated.data?.results ?? [])
    .filter((asset) => Number(asset.meta?.frame_index) === frame.index)
    .slice(0, EARLIER_LIMIT);
  const promptLength = charCount(prompt);
  const promptMissing = prompt.trim() === '';

  const generationDone = () => {
    setGenJob(null);
    queryClient.invalidateQueries({ queryKey: [accountId, 'assets'] });
    refetch();
    onGenerated();
  };

  const startError = (error: unknown) => {
    if (isApiError(error) && error.code === 'provider_not_configured') {
      notification.error({ title: NOT_CONFIGURED_TEXT });
      return true;
    }
    if (isApiError(error) && error.code === 'rate_limited') {
      notification.error({ title: CAP_REACHED_TEXT });
      generated.refetch();
      return true;
    }
    if (isApiError(error) && error.code === 'validation_error') {
      const text = error.fields
        .map((field) => field.message)
        .filter(Boolean)
        .join(' ');
      notification.error({
        title: ERROR_TEXT.validation_error,
        description: text || undefined,
      });
      return true;
    }
    handleError(error);
    return true;
  };

  const popoverContent = (
    <Flex vertical gap={token.marginXS} style={{ width: 360 }}>
      <label htmlFor={`prompt-${frame.index}`}>
        <Typography.Text strong>Describe the image</Typography.Text>
      </label>
      <Input.TextArea
        id={`prompt-${frame.index}`}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        autoSize={{ minRows: 3, maxRows: 8 }}
        status={promptLength > PROMPT_MAX ? 'error' : undefined}
        aria-describedby={`prompt-help-${frame.index}`}
      />
      <Flex justify="space-between" gap={token.marginXS}>
        <Typography.Text type="secondary" id={`prompt-help-${frame.index}`}>
          Describe a scene. Text is added by the template, not the image.
        </Typography.Text>
        <Counter count={promptLength} max={PROMPT_MAX} />
      </Flex>
      <Typography.Text type="secondary" italic>
        {styleLine(script.data?.payload?.design_notes)}
      </Typography.Text>
      <Flex justify="end" gap={token.marginXS}>
        <Button onClick={() => setPopoverOpen(false)}>Cancel</Button>
        <JobButton
          type="primary"
          start={() =>
            generateFrameImage(item.id, {
              base_version: production.version as number,
              frame_index: frame.index,
              prompt: prompt.trim(),
              attach: true,
              rerender: true,
            })
          }
          onStarted={(job) => {
            setGenJob(job);
            onJobStarted(job, true);
            setPopoverOpen(false);
          }}
          onStartError={startError}
          failureText={generateFailureText}
          successMessage="Background generated"
          disabled={promptMissing || promptLength > PROMPT_MAX || atCap}
          disabledReason={atCap ? CAP_REACHED_TEXT : undefined}
        >
          Generate
        </JobButton>
      </Flex>
    </Flex>
  );

  return (
    <Flex vertical gap={token.marginSM}>
      <Flex gap={token.margin} align="flex-start" wrap>
        <div
          style={{
            height: THUMB_HEIGHT,
            aspectRatio: layout === '4x5' ? '4 / 5' : '9 / 16',
            flex: 'none',
            overflow: 'hidden',
            borderRadius: token.borderRadius,
            border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
            background: token.colorFillTertiary,
          }}
        >
          {current?.thumbnail_url || current?.url ? (
            <img
              src={current.thumbnail_url ?? current.url}
              alt="Current background"
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
              style={{ height: '100%' }}
              gap={token.marginXXS}
            >
              <PictureOutlined
                aria-hidden
                style={{ color: token.colorTextQuaternary }}
              />
              <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
                Brand background
              </Typography.Text>
            </Flex>
          )}
        </div>
        <Flex vertical gap={token.marginXS} style={{ flex: 1, minWidth: 200 }}>
          {genJob ? (
            <JobProgress
              jobId={genJob.id}
              variant="inline"
              failureText={generateFailureText}
              onDone={() => {
                message.success('Background generated');
                generationDone();
              }}
              onFailed={(job) => {
                notification.error({ title: generateFailureText(job) });
                setGenJob(null);
                generated.refetch();
              }}
            />
          ) : null}
          {current ? (
            <Space size={token.marginXXS} wrap>
              <RightsTag
                status={current.rights_status}
                licenseNote={current.license_note}
                expiresAt={current.rights_expires_at}
              />
              {current.origin === 'ai_generated' ? (
                <Tag>AI generated</Tag>
              ) : null}
            </Space>
          ) : null}
          <Space wrap size={token.marginXS}>
            <Button onClick={() => setPicking(true)} disabled={disabled}>
              Choose from library
            </Button>
            <Popover
              open={popoverOpen && !disabled}
              onOpenChange={(open) => {
                if (open) setPrompt(frame.visual_prompt ?? '');
                setPopoverOpen(open);
              }}
              trigger="click"
              title="Generate image"
              content={popoverContent}
              destroyOnHidden
            >
              <Tooltip title={atCap ? CAP_REACHED_TEXT : undefined}>
                <Button disabled={disabled || atCap}>Generate image</Button>
              </Tooltip>
            </Popover>
            <Button
              onClick={() => onChange(null)}
              disabled={disabled || !current}
            >
              Remove background
            </Button>
          </Space>
          <Typography.Text type="secondary">
            {usedCount} of {GENERATED_IMAGE_CAP} generated images used for this
            item
          </Typography.Text>
        </Flex>
      </Flex>
      {earlier.length > 0 ? (
        <Flex vertical gap={token.marginXXS}>
          <Typography.Text type="secondary">
            Earlier images for this frame
          </Typography.Text>
          <Flex gap={token.marginXS} wrap>
            {earlier.map((asset, position) => {
              const chosen = current?.id === asset.id;
              return (
                <button
                  key={asset.id}
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`Use earlier image ${position + 1}`}
                  disabled={disabled}
                  onClick={() => onChange(toBackgroundRef(asset))}
                  style={{
                    width: 56,
                    aspectRatio: layout === '4x5' ? '4 / 5' : '9 / 16',
                    padding: 0,
                    overflow: 'hidden',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    borderRadius: token.borderRadiusSM,
                    border: `${chosen ? token.lineWidthBold : token.lineWidth}px ${token.lineType} ${
                      chosen ? token.colorPrimary : token.colorBorderSecondary
                    }`,
                    background: token.colorFillTertiary,
                  }}
                >
                  <img
                    src={asset.thumbnail_url ?? asset.url}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                </button>
              );
            })}
          </Flex>
        </Flex>
      ) : null}
      <AssetPicker
        open={picking}
        accountId={accountId}
        kind="image"
        uploadRole="background"
        contentItemId={item.id}
        selectedId={current?.id ?? null}
        onSelect={(asset) => onChange(toBackgroundRef(asset))}
        onClose={() => setPicking(false)}
      />
    </Flex>
  );
};

export default BackgroundSection;
