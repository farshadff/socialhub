import { SoundOutlined, StarFilled } from '@ant-design/icons';
import { ProCard } from '@ant-design/pro-components';
import {
  Button,
  Flex,
  message,
  Popconfirm,
  Space,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useState } from 'react';
import AssetPicker from '@/pages/content/shared/AssetPicker';
import JobButton from '@/components/JobButton';
import RightsTag from '@/pages/content/shared/RightsTag';
import { formatDuration } from '@/services/socialhub/assets';
import {
  renderProduction,
  updateProductionSettings,
} from '@/services/socialhub/production';
import {
  frameNeedsRender,
  productionFailureText,
  useProductionContext,
} from './shared';

/** Music (and, for reels, the cover) of a motion or video item (E06-S03 panel, hosted by S07). */
const MusicCoverCard: React.FC = () => {
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
    isCurrentDraft,
    onUrlExpired,
  } = useProductionContext();
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const music = production.music_asset;
  const editable = production.actions.can_edit_frames && isCurrentDraft;
  const disabled = !editable || jobRunning || saving;
  const isReel = production.format === 'reel';
  const framesReady = !production.frames.some(frameNeedsRender);
  const needsRebuild =
    production.actions.can_render &&
    production.render_status === 'pending' &&
    framesReady;

  const setMusic = async (musicAssetId: number | null) => {
    if (production.version === null) return;
    setSaving(true);
    try {
      const next = await updateProductionSettings(item.id, {
        base_version: production.version,
        music_asset_id: musicAssetId,
      });
      setProduction(next);
      message.success(musicAssetId === null ? 'Music removed' : 'Music saved');
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  };

  const coverFrame = production.frames.find(
    (frame) => frame.index === production.cover_frame_index,
  );

  return (
    <ProCard title={isReel ? 'Music and cover' : 'Music'}>
      <Flex vertical gap={token.margin}>
        <Flex vertical gap={token.marginXS}>
          <Typography.Text strong>Music</Typography.Text>
          {music ? (
            <Flex vertical gap={token.marginXS}>
              <Space size={token.marginXS} wrap>
                <SoundOutlined aria-hidden />
                <Typography.Text>
                  {music.original_filename ?? `Audio ${music.id}`}
                </Typography.Text>
                {music.duration_ms ? (
                  <Typography.Text type="secondary">
                    {formatDuration(music.duration_ms)}
                  </Typography.Text>
                ) : null}
                {music.rights_status ? (
                  <RightsTag
                    status={music.rights_status}
                    licenseNote={music.license_note}
                    expiresAt={music.rights_expires_at}
                  />
                ) : null}
              </Space>
              {music.url ? (
                // biome-ignore lint/a11y/useMediaCaption: music has no caption track
                <audio
                  src={music.url}
                  controls
                  preload="none"
                  aria-label={`Music ${music.original_filename ?? ''}`}
                  onError={onUrlExpired}
                  style={{ width: '100%', maxWidth: 420 }}
                />
              ) : null}
            </Flex>
          ) : (
            <Typography.Text type="secondary">
              No music. The video has a silent soundtrack.
            </Typography.Text>
          )}
          {editable ? (
            <Space wrap size={token.marginXS}>
              <Tooltip title={jobRunning ? runningReason : undefined}>
                <Button
                  onClick={() => setPicking(true)}
                  disabled={disabled}
                  loading={saving}
                >
                  {music ? 'Change music' : 'Choose music'}
                </Button>
              </Tooltip>
              {music ? (
                <Popconfirm
                  title="Remove the music from this video?"
                  okText="Remove"
                  onConfirm={() => setMusic(null)}
                  disabled={disabled}
                >
                  <Button disabled={disabled}>Remove music</Button>
                </Popconfirm>
              ) : null}
              {needsRebuild ? (
                <JobButton
                  start={() =>
                    renderProduction(item.id, {
                      base_version: production.version as number,
                      frames: [],
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
                  successMessage="Video rebuilt"
                  failureText={productionFailureText}
                  disabled={jobRunning}
                  disabledReason={runningReason}
                  runningReason={runningReason}
                >
                  Rebuild video
                </JobButton>
              ) : null}
            </Space>
          ) : null}
        </Flex>

        {isReel ? (
          <Flex vertical gap={token.marginXXS}>
            <Typography.Text strong>Cover</Typography.Text>
            <Typography.Text>
              {coverFrame ? `Frame ${coverFrame.index}` : 'The first frame'}
            </Typography.Text>
            <Typography.Text type="secondary">
              Choose the cover with the{' '}
              <StarFilled aria-hidden style={{ color: token.colorWarning }} />{' '}
              on a frame.
            </Typography.Text>
          </Flex>
        ) : null}
      </Flex>
      <AssetPicker
        open={picking}
        accountId={accountId}
        kind="audio"
        uploadRole="music"
        contentItemId={item.id}
        selectedId={music?.id ?? null}
        onSelect={(asset) => setMusic(asset.id)}
        onClose={() => setPicking(false)}
      />
    </ProCard>
  );
};

export default MusicCoverCard;
