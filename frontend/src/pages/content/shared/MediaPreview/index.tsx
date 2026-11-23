import { CloseCircleOutlined, PictureOutlined } from '@ant-design/icons';
import { Flex, Space, Spin, Switch, Tag, Typography, theme } from 'antd';
import React, { useEffect, useId, useRef, useState } from 'react';
import RightsTag from '@/pages/content/shared/RightsTag';
import { useFormats } from '@/pages/content/shared/useFormats';
import { formatBytes, type RightsStatus } from '@/services/socialhub/assets';
import type { Format, MediaKind, SafeArea } from '@/services/socialhub/formats';

export type PreviewAsset = {
  url: string;
  thumbnail_url?: string | null;
  kind?: 'image' | 'video' | 'audio' | 'document' | string;
  mime?: string;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  bytes?: number | null;
  rights_status?: RightsStatus;
  license_note?: string;
  rights_expires_at?: string | null;
};

export type MediaPreviewState = 'idle' | 'rendering' | 'failed' | 'empty';

export type MediaPreviewProps = {
  asset: PreviewAsset | null;
  format: Format;
  /** Which registry entry to read; defaults to the asset's kind. */
  mediaKind?: MediaKind;
  /** Reels: shown as the poster and in "Cover" mode. */
  cover?: PreviewAsset | null;
  showSafeAreaDefault?: boolean;
  state?: MediaPreviewState;
  maxHeight?: number;
  /** Alt text or caption for screen readers. */
  alt?: string;
  /** Called when the media fails to load, so the parent refetches signed URLs. */
  onUrlExpired?: () => void;
  /** Shows an "AI-generated content" tag under the preview. */
  usesAiGenerated?: boolean;
  /** Hides the toggles and the facts line (small previews such as the frame drawer). */
  compact?: boolean;
};

/** Canvas sizes used until the registry loads (E06-S02 rule 2). */
const FALLBACK_SIZE: Record<Format, { width: number; height: number }> = {
  feed_post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  reel: { width: 1080, height: 1920 },
};

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

/** "20 s", "1 min 5 s" for preview facts. */
export function secondsText(ms: number): string {
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60)
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

/** "20 seconds", "4.5 seconds" for screen readers. */
export function spokenSeconds(ms: number): string {
  const value = Math.round(ms / 100) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${value === 1 ? 'second' : 'seconds'}`;
}

/** "1080 × 1920 · 20 s · 5.6 MB" */
export function factsText(asset: PreviewAsset): string {
  const parts: string[] = [];
  if (asset.width && asset.height)
    parts.push(`${asset.width} × ${asset.height}`);
  if (asset.duration_ms) parts.push(secondsText(asset.duration_ms));
  if (asset.bytes) parts.push(formatBytes(asset.bytes));
  return parts.join(' · ');
}

/** The regions Instagram covers, as percentages of the canvas (so they scale with the preview). */
export function safeAreaBands(safe: SafeArea, width: number, height: number) {
  return {
    top: { top: 0, left: 0, right: 0, height: pct(safe.top, height) },
    bottom: { bottom: 0, left: 0, right: 0, height: pct(safe.bottom, height) },
    left: {
      top: pct(safe.top, height),
      bottom: pct(safe.bottom, height),
      left: 0,
      width: pct(safe.left, width),
    },
    right: {
      top: pct(safe.top, height),
      bottom: pct(safe.bottom, height),
      right: 0,
      width: pct(safe.right, width),
    },
    outline: {
      top: pct(safe.top, height),
      bottom: pct(safe.bottom, height),
      left: pct(safe.left, width),
      right: pct(safe.right, width),
    },
  };
}

/**
 * Image or video in the format's aspect ratio with a safe-area overlay toggle (E06-S07).
 * Reused by the review page (E07-S06) and the publishing tab (E08).
 */
const MediaPreview: React.FC<MediaPreviewProps> = ({
  asset,
  format,
  mediaKind,
  cover,
  showSafeAreaDefault = false,
  state = 'idle',
  maxHeight = 560,
  alt,
  onUrlExpired,
  usesAiGenerated,
  compact,
}) => {
  const { token } = theme.useToken();
  const { data, getSpec } = useFormats();
  const [showSafeArea, setShowSafeArea] = useState(showSafeAreaDefault);
  const [showCover, setShowCover] = useState(false);
  const reportedUrl = useRef<string | null>(null);
  const safeId = useId();
  const coverId = useId();

  const isVideo =
    asset?.kind === 'video' || !!asset?.mime?.startsWith('video/');
  const kind: MediaKind = mediaKind ?? (isVideo ? 'video' : 'image');
  const spec =
    getSpec(format, kind) ??
    data?.specs.find((entry) => entry.format === format);
  const width = spec?.width ?? FALLBACK_SIZE[format].width;
  const height = spec?.height ?? FALLBACK_SIZE[format].height;
  const safe = spec?.safe_area;
  const coverAvailable = format === 'reel' && isVideo && !!cover;

  useEffect(() => {
    if (!coverAvailable) setShowCover(false);
  }, [coverAvailable]);

  const handleError = () => {
    if (!asset || reportedUrl.current === asset.url) return;
    reportedUrl.current = asset.url;
    onUrlExpired?.();
  };

  const effectiveState: MediaPreviewState =
    state === 'idle' && !asset ? 'empty' : state;
  const durationLabel = asset?.duration_ms
    ? `, ${spokenSeconds(asset.duration_ms)}`
    : '';

  let media: React.ReactNode = null;
  if (asset && effectiveState !== 'empty') {
    if (isVideo && !showCover) {
      media = (
        <video
          key={asset.url}
          src={asset.url}
          poster={cover?.url ?? asset.thumbnail_url ?? undefined}
          controls
          muted
          playsInline
          preload="metadata"
          aria-label={`Video preview${durationLabel}`}
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      );
    } else {
      const source = showCover && cover ? cover : asset;
      media = (
        <img
          key={source.url}
          src={source.url}
          alt=""
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      );
    }
  }

  const imageRole = !isVideo || showCover || effectiveState === 'empty';
  const stateLabel: Partial<Record<MediaPreviewState, string>> = {
    rendering: 'Rendering…',
    failed: 'Render failed',
    empty: 'Nothing rendered yet',
  };
  const imageLabel = stateLabel[effectiveState] ?? (alt || 'Media preview');
  const bands = safe ? safeAreaBands(safe, width, height) : null;
  const bandStyle: React.CSSProperties = {
    position: 'absolute',
    background: token.colorBgMask,
    pointerEvents: 'none',
  };

  let overlay: React.ReactNode = null;
  if (effectiveState === 'rendering') {
    overlay = (
      <Flex vertical align="center" gap={token.marginXS}>
        <Spin />
        <Typography.Text style={{ color: token.colorTextLightSolid }}>
          Rendering…
        </Typography.Text>
      </Flex>
    );
  } else if (effectiveState === 'failed') {
    overlay = (
      <Flex vertical align="center" gap={token.marginXS}>
        <CloseCircleOutlined
          aria-hidden
          style={{ color: token.colorError, fontSize: token.fontSizeHeading2 }}
        />
        <Typography.Text style={{ color: token.colorTextLightSolid }}>
          Render failed
        </Typography.Text>
      </Flex>
    );
  }

  return (
    <Flex
      vertical
      gap={token.marginXS}
      align="center"
      style={{ width: '100%' }}
    >
      <div
        data-testid="media-frame"
        {...(imageRole ? { role: 'img', 'aria-label': imageLabel } : {})}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: (maxHeight * width) / height,
          aspectRatio: `${width} / ${height}`,
          maxHeight,
          overflow: 'hidden',
          borderRadius: token.borderRadius,
          border: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
          background: token.colorFillTertiary,
        }}
      >
        {media}
        {effectiveState === 'empty' ? (
          <Flex
            vertical
            align="center"
            justify="center"
            gap={token.marginXS}
            style={{ position: 'absolute', inset: 0 }}
          >
            <PictureOutlined
              aria-hidden
              style={{
                fontSize: token.fontSizeHeading2,
                color: token.colorTextQuaternary,
              }}
            />
            <Typography.Text type="secondary">
              Nothing rendered yet
            </Typography.Text>
          </Flex>
        ) : null}
        {bands && showSafeArea ? (
          <div data-testid="safe-area" aria-hidden>
            <div data-band="top" style={{ ...bandStyle, ...bands.top }} />
            <div data-band="bottom" style={{ ...bandStyle, ...bands.bottom }} />
            <div data-band="left" style={{ ...bandStyle, ...bands.left }} />
            <div data-band="right" style={{ ...bandStyle, ...bands.right }} />
            <div
              data-band="outline"
              style={{
                position: 'absolute',
                ...bands.outline,
                border: `${token.lineWidthBold}px dashed ${token.colorPrimary}`,
                pointerEvents: 'none',
              }}
            />
          </div>
        ) : null}
        {overlay ? (
          <Flex
            align="center"
            justify="center"
            style={{
              position: 'absolute',
              inset: 0,
              background: token.colorBgMask,
            }}
          >
            {overlay}
          </Flex>
        ) : null}
      </div>
      {compact ? null : (
        <Flex
          wrap
          gap={token.marginSM}
          align="center"
          justify="center"
          style={{ width: '100%' }}
        >
          {bands ? (
            <Space size={token.marginXS}>
              <Switch
                id={safeId}
                size="small"
                checked={showSafeArea}
                onChange={setShowSafeArea}
              />
              <label htmlFor={safeId}>Safe area</label>
            </Space>
          ) : null}
          {coverAvailable ? (
            <Space size={token.marginXS}>
              <Switch
                id={coverId}
                size="small"
                checked={showCover}
                onChange={setShowCover}
              />
              <label htmlFor={coverId}>Cover</label>
            </Space>
          ) : null}
        </Flex>
      )}
      {compact || !asset ? null : (
        <Flex wrap gap={token.marginXS} align="center" justify="center">
          {factsText(asset) ? (
            <Typography.Text type="secondary">
              {factsText(asset)}
            </Typography.Text>
          ) : null}
          {asset.rights_status ? (
            <RightsTag
              status={asset.rights_status}
              licenseNote={asset.license_note}
              expiresAt={asset.rights_expires_at}
            />
          ) : null}
          {usesAiGenerated ? <Tag>AI-generated content</Tag> : null}
        </Flex>
      )}
    </Flex>
  );
};

export default MediaPreview;
