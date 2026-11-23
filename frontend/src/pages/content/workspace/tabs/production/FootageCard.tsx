import { VideoCameraOutlined } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import {
  Alert,
  Button,
  Flex,
  InputNumber,
  message,
  Space,
  Table,
  type TableColumnsType,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import AssetPicker from '@/pages/content/shared/AssetPicker';
import ContentText from '@/components/ContentText';
import FrameWarning from '@/pages/content/shared/FrameWarning';
import JobButton from '@/components/JobButton';
import JobProgress from '@/components/JobProgress';
import RightsTag from '@/pages/content/shared/RightsTag';
import StatusTag from '@/components/StatusTag';
import { formatDuration } from '@/services/socialhub/assets';
import { isApiError } from '@/services/socialhub/http';
import {
  type ProductionClip,
  type ProductionShot,
  renderProduction,
  updateClips,
} from '@/services/socialhub/production';
import { fieldErrorText } from '@/utils/errorText';
import { useLeaveGuard } from '@/pages/content/shared/leaveGuard';
import { productionFailureText, seconds, useProductionContext } from './shared';

type ClipAsset = ProductionClip['asset'];
type Mapping = Record<number, { asset: ClipAsset; start_ms: number }>;

export type ClipStatus = 'needs_clip' | 'ok' | 'padded' | 'too_short';

/** E06-S04 rule 9, computed in the browser so "Too short" shows before saving. */
export function clipStatus(
  shotSeconds: number,
  entry: { asset: { duration_ms: number }; start_ms: number } | undefined,
): { status: ClipStatus; shortfallMs: number } {
  if (!entry) return { status: 'needs_clip', shortfallMs: 0 };
  const usable = entry.asset.duration_ms - entry.start_ms;
  const shortfall = Math.round(shotSeconds * 1000 - usable);
  if (shortfall > 1000) return { status: 'too_short', shortfallMs: shortfall };
  if (shortfall > 0) return { status: 'padded', shortfallMs: shortfall };
  return { status: 'ok', shortfallMs: 0 };
}

function mappingFrom(clips: ProductionClip[]): Mapping {
  const mapping: Mapping = {};
  for (const clip of clips)
    mapping[clip.shot_index] = { asset: clip.asset, start_ms: clip.start_ms };
  return mapping;
}

function sameMapping(a: Mapping, b: Mapping): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[Number(key)];
    const right = b[Number(key)];
    if (!left || !right) return false;
    if (left.asset.id !== right.asset.id || left.start_ms !== right.start_ms)
      return false;
  }
  return true;
}

/** A small muted preview that seeks to the in-point whenever it changes (E06-S04 FE2). */
const InPointPreview: React.FC<{
  url?: string;
  poster?: string | null;
  startMs: number;
}> = ({ url, poster, startMs }) => {
  const { token } = theme.useToken();
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => {
      video.currentTime = startMs / 1000;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [startMs, url]);
  if (!url) return null;
  return (
    <video
      ref={ref}
      src={url}
      poster={poster ?? undefined}
      muted
      playsInline
      preload="metadata"
      aria-label={`Clip at ${seconds(startMs / 1000)}`}
      style={{
        width: 48,
        aspectRatio: '9 / 16',
        objectFit: 'cover',
        borderRadius: token.borderRadiusSM,
        background: token.colorFillTertiary,
      }}
    />
  );
};

/** The Footage card for `video` mode (E06-S04 FE1). */
const FootageCard: React.FC = () => {
  const { token } = theme.useToken();
  const {
    item,
    production,
    accountId,
    setProduction,
    handleError,
    jobRunning,
    runningReason,
    onJobStarted,
    onJobEnded,
    refetch,
    reload,
    activeJob,
    isCurrentDraft,
  } = useProductionContext();
  const saved = useMemo(
    () => mappingFrom(production.clips),
    [production.clips],
  );
  const [mapping, setMapping] = useState<Mapping>(saved);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [picking, setPicking] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = !sameMapping(mapping, saved);
  useLeaveGuard(
    dirty,
    'Your footage changes are not saved. Leave without saving?',
  );

  // Take the server's mapping whenever it changes and nothing local is unsaved.
  const savedKey = JSON.stringify(
    production.clips.map((c) => [c.shot_index, c.asset.id, c.start_ms]),
  );
  useEffect(() => {
    if (!dirty) setMapping(saved);
  }, [savedKey]);

  const editable = production.actions.can_edit_frames && isCurrentDraft;
  const disabled = !editable || jobRunning || saving;
  const footageShots = production.shots.filter(
    (shot) => shot.type === 'footage',
  );
  const withClip = footageShots.filter((shot) => mapping[shot.index]).length;
  const missing = footageShots.length - withClip;
  const tooShort = footageShots.some(
    (shot) =>
      clipStatus(shot.duration_seconds, mapping[shot.index]).status ===
      'too_short',
  );
  const renderJob = jobRunning && activeJob?.kind === 'production.render';

  const save = async () => {
    if (production.version === null) return;
    const clips = footageShots
      .filter((shot) => mapping[shot.index])
      .map((shot) => ({
        shot_index: shot.index,
        asset_id: mapping[shot.index].asset.id,
        start_ms: mapping[shot.index].start_ms,
      }));
    setSaving(true);
    setRowErrors({});
    try {
      const next = await updateClips(item.id, {
        base_version: production.version,
        clips,
      });
      setProduction(next);
      setMapping(mappingFrom(next.clips));
      message.success('Footage saved');
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        const errors: Record<number, string> = {};
        const general: string[] = [];
        for (const field of error.fields) {
          const match = field.path.match(/^clips\.(\d+)/);
          const sent = match ? clips[Number(match[1])] : undefined;
          if (sent)
            errors[sent.shot_index] = field.message || fieldErrorText(field);
          else general.push(field.message || fieldErrorText(field));
        }
        setRowErrors(errors);
        if (general.length) message.error(general.join(' '));
      } else {
        handleError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const shotOnScreen = (shot: ProductionShot) => {
    const headlines = shot.frame_indexes
      .map(
        (index) =>
          production.frames.find((frame) => frame.index === index)?.headline,
      )
      .filter(Boolean);
    return headlines.length ? (
      <ContentText>{headlines.join(' · ')}</ContentText>
    ) : (
      '—'
    );
  };

  const columns: TableColumnsType<ProductionShot> = [
    {
      title: 'Shot',
      key: 'shot',
      width: 72,
      render: (_, shot) => `${shot.index} · ${seconds(shot.duration_seconds)}`,
    },
    {
      title: 'What to film',
      key: 'film',
      render: (_, shot) => (
        <Flex vertical>
          <ContentText>{shot.description}</ContentText>
          {shot.asset_hint ? (
            <Typography.Text type="secondary">
              <ContentText>{shot.asset_hint}</ContentText>
            </Typography.Text>
          ) : null}
        </Flex>
      ),
    },
    {
      title: 'On-screen text',
      key: 'text',
      render: (_, shot) => shotOnScreen(shot),
    },
    {
      title: 'Clip',
      key: 'clip',
      render: (_, shot) => {
        if (shot.type !== 'footage') {
          const frame = production.frames.find((f) =>
            shot.frame_indexes.includes(f.index),
          );
          const thumb = frame?.asset?.thumbnail_url ?? frame?.asset?.url;
          return (
            <Space size={token.marginXS}>
              {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  style={{
                    width: 32,
                    aspectRatio: '9 / 16',
                    objectFit: 'cover',
                    borderRadius: token.borderRadiusSM,
                  }}
                />
              ) : null}
              <Typography.Text type="secondary">
                Rendered graphic
              </Typography.Text>
            </Space>
          );
        }
        const entry = mapping[shot.index];
        return (
          <Flex vertical gap={token.marginXXS}>
            {entry ? (
              <Space size={token.marginXS} align="start">
                {entry.asset.thumbnail_url ? (
                  <img
                    src={entry.asset.thumbnail_url}
                    alt=""
                    style={{
                      width: 40,
                      height: 40,
                      objectFit: 'cover',
                      borderRadius: token.borderRadiusSM,
                    }}
                  />
                ) : (
                  <VideoCameraOutlined aria-hidden />
                )}
                <Flex vertical>
                  <Typography.Text ellipsis style={{ maxWidth: 160 }}>
                    {entry.asset.original_filename}
                  </Typography.Text>
                  <Space size={token.marginXXS}>
                    <Typography.Text type="secondary">
                      {formatDuration(entry.asset.duration_ms)}
                    </Typography.Text>
                    <RightsTag status={entry.asset.rights_status} />
                  </Space>
                </Flex>
              </Space>
            ) : null}
            {editable ? (
              <Space size={token.marginXS}>
                <Button
                  size="small"
                  disabled={disabled}
                  onClick={() => setPicking(shot.index)}
                >
                  {entry ? 'Change' : 'Choose clip'}
                </Button>
                {entry ? (
                  <Button
                    size="small"
                    disabled={disabled}
                    onClick={() =>
                      setMapping((current) => {
                        const next = { ...current };
                        delete next[shot.index];
                        return next;
                      })
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </Space>
            ) : null}
          </Flex>
        );
      },
    },
    {
      title: 'Start at',
      key: 'start',
      width: 160,
      render: (_, shot) => {
        const entry = mapping[shot.index];
        if (shot.type !== 'footage' || !entry) return '—';
        return (
          <Space size={token.marginXS} align="center">
            <InputNumber
              aria-label={`Start of the clip for shot ${shot.index}, in seconds`}
              size="small"
              min={0}
              max={Math.max(0, (entry.asset.duration_ms - 100) / 1000)}
              step={0.1}
              precision={1}
              suffix="s"
              style={{ width: 84 }}
              disabled={disabled}
              value={entry.start_ms / 1000}
              onChange={(value) =>
                setMapping((current) => ({
                  ...current,
                  [shot.index]: {
                    ...entry,
                    start_ms: Math.round((value ?? 0) * 1000),
                  },
                }))
              }
            />
            <InPointPreview
              url={entry.asset.url}
              poster={entry.asset.thumbnail_url}
              startMs={entry.start_ms}
            />
          </Space>
        );
      },
    },
    {
      title: 'Status',
      key: 'status',
      width: 140,
      render: (_, shot) => {
        if (shot.type !== 'footage') return null;
        const { status, shortfallMs } = clipStatus(
          shot.duration_seconds,
          mapping[shot.index],
        );
        const tag =
          status === 'padded' ? (
            <Tooltip
              title={`The clip is ${seconds(shortfallMs / 1000)} shorter than the shot from this start point. Its last frame is held to fill the gap.`}
            >
              <span>
                <StatusTag
                  kind="clip"
                  status="padded"
                  label={`Padded ${seconds(shortfallMs / 1000)}`}
                />
              </span>
            </Tooltip>
          ) : status === 'too_short' ? (
            <Tooltip
              title={`The clip is ${seconds(shortfallMs / 1000)} too short from this start point. Choose an earlier start or another clip.`}
            >
              <span>
                <StatusTag kind="clip" status="too_short" />
              </span>
            </Tooltip>
          ) : (
            <StatusTag kind="clip" status={status} />
          );
        return (
          <Flex vertical gap={token.marginXXS}>
            {tag}
            {rowErrors[shot.index] ? (
              <Typography.Text type="danger">
                {rowErrors[shot.index]}
              </Typography.Text>
            ) : null}
          </Flex>
        );
      },
    },
  ];

  const clipWarnings = production.render_warnings.filter(
    (warning) =>
      warning.code.startsWith('clip_') ||
      (warning.code === 'rights_not_cleared' &&
        warning.asset_id &&
        !warning.frame_index) ||
      (warning.shot_index !== undefined && !warning.frame_index),
  );
  const assemblyFailed = production.render_status === 'failed' && !jobRunning;
  const assembleReason = jobRunning
    ? runningReason
    : missing > 0
      ? 'Add footage for every shot first'
      : dirty
        ? 'Save the footage first'
        : tooShort
          ? 'Fix the clips that are too short first'
          : undefined;

  const assembleButton = (label: string, primary: boolean) => (
    <JobButton
      type={primary ? 'primary' : 'default'}
      start={() =>
        renderProduction(item.id, {
          base_version: production.version as number,
          frames: null,
          reassemble: true,
        })
      }
      onStarted={(job) => onJobStarted(job, true)}
      onDone={() => {
        onJobEnded();
        refetch();
        reload();
      }}
      onFailed={() => {
        onJobEnded();
        refetch();
      }}
      onStartError={(error) => {
        handleError(error);
        return true;
      }}
      successMessage="Video assembled"
      failureText={productionFailureText}
      disabled={!!assembleReason || !production.actions.can_render}
      disabledReason={assembleReason}
      runningReason={runningReason}
    >
      {label}
    </JobButton>
  );

  return (
    <ProCard
      title="Footage"
      extra={
        <Space wrap size={token.marginXS}>
          <Typography.Text type="secondary">
            {withClip} of {footageShots.length}{' '}
            {footageShots.length === 1 ? 'shot has' : 'shots have'} a clip
          </Typography.Text>
          {editable ? (
            <>
              <Button
                type={dirty ? 'primary' : 'default'}
                onClick={save}
                loading={saving}
                disabled={disabled || !dirty}
              >
                Save footage
              </Button>
              {assembleButton('Assemble video', false)}
            </>
          ) : null}
        </Space>
      }
    >
      <Flex vertical gap={token.margin}>
        {withClip === 0 && editable ? (
          <Alert
            type="info"
            showIcon
            title="This item needs footage. Film the shots below, then upload a clip for each."
          />
        ) : null}
        {assemblyFailed && editable ? (
          <Alert
            type="error"
            showIcon
            title="The video could not be assembled."
            action={assembleButton('Try again', false)}
          />
        ) : null}
        {renderJob && activeJob ? (
          <JobProgress job={activeJob} variant="inline" />
        ) : null}
        <Table<ProductionShot>
          rowKey="index"
          size="small"
          columns={columns}
          dataSource={production.shots}
          pagination={false}
          scroll={{ x: 760 }}
        />
        {clipWarnings.length > 0 ? (
          <FrameWarning warnings={clipWarnings} showLocator />
        ) : null}
      </Flex>
      <AssetPicker
        open={picking !== null}
        accountId={accountId}
        kind="video"
        uploadRole="clip"
        contentItemId={item.id}
        selectedId={
          picking !== null ? (mapping[picking]?.asset.id ?? null) : null
        }
        onSelect={(asset) => {
          if (picking === null) return;
          setMapping((current) => ({
            ...current,
            [picking]: {
              asset: {
                id: asset.id,
                original_filename: asset.original_filename,
                duration_ms: asset.duration_ms ?? 0,
                width: asset.width,
                height: asset.height,
                thumbnail_url: asset.thumbnail_url,
                rights_status: asset.rights_status,
                url: asset.url,
              },
              start_ms: 0,
            },
          }));
          setRowErrors((current) => {
            const next = { ...current };
            delete next[picking];
            return next;
          });
        }}
        onClose={() => setPicking(null)}
      />
    </ProCard>
  );
};

export default FootageCard;
