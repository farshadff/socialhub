import { InboxOutlined, PictureOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Flex,
  Form,
  Modal,
  message,
  Progress,
  Tabs,
  Typography,
  theme,
  Upload,
} from 'antd';
import React, { useEffect, useState } from 'react';
import { AssetBrowser } from '@/pages/content/shared/AssetPicker';
import {
  RIGHTS_DEFAULTS,
  RightsFormFields,
  type RightsFormValues,
  toRightsFields,
} from '@/pages/content/shared/AssetUploader';
import { useFormats } from '@/pages/content/shared/useFormats';
import {
  type Asset,
  KIND_RULES,
  precheckFile,
  rejectionReasons,
} from '@/services/socialhub/assets';
import type { FormatSpec } from '@/services/socialhub/formats';
import { isApiError } from '@/services/socialhub/http';
import { uploadFinalAsset } from '@/services/socialhub/production';
import { errorText, fieldErrorText } from '@/utils/errorText';
import { useProductionContext } from './shared';

const FORMAT_PLURAL: Record<string, string> = {
  reel: 'reels',
  story: 'stories',
  feed_post: 'feed posts',
};

const CODEC_NAME: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  aac: 'AAC',
  mp3: 'MP3',
  mp4: 'MP4',
  mov: 'MOV',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
};

const codec = (value: string | null | undefined) =>
  value ? (CODEC_NAME[value.toLowerCase()] ?? value.toUpperCase()) : null;

/** "100 MB" (whole megabytes when exact). */
function megabytes(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** "Video · 9:16 · 1080 × 1920 · 5–90 s · MP4 (H.264, AAC) · up to 100 MB" from the registry. */
export function requirementsLine(spec: FormatSpec): string {
  const parts: string[] = [
    spec.media_kind === 'video' ? 'Video' : 'Image',
    spec.aspect_ratio,
    `${spec.width} × ${spec.height}`,
  ];
  if (spec.media_kind === 'video') {
    if (spec.min_duration_s !== null && spec.max_duration_s !== null) {
      parts.push(`${spec.min_duration_s}–${spec.max_duration_s} s`);
    }
    const codecs = [codec(spec.video_codec), codec(spec.audio_codec)]
      .filter(Boolean)
      .join(', ');
    const container = codec(spec.container);
    if (container) parts.push(codecs ? `${container} (${codecs})` : container);
  } else if (spec.image_mime) {
    parts.push(codec(spec.image_mime) as string);
  }
  if (spec.max_file_bytes)
    parts.push(`up to ${megabytes(spec.max_file_bytes)}`);
  return parts.join(' · ');
}

export type UploadFinalModalProps = {
  open: boolean;
  onClose: () => void;
};

/** "Use my own file" (E06-S07 FE5): upload or pick a finished asset and use it as the final asset. */
const UploadFinalModal: React.FC<UploadFinalModalProps> = ({
  open,
  onClose,
}) => {
  const { token } = theme.useToken();
  const {
    item,
    production,
    accountId,
    setProduction,
    reload,
    handleError,
    onJobStarted,
  } = useProductionContext();
  const { getSpec } = useFormats();
  const [form] = Form.useForm<RightsFormValues>();
  const [tab, setTab] = useState<'upload' | 'library'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Asset | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverProblem, setCoverProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [rejection, setRejection] = useState<string[]>([]);

  const mediaKind = production.media_kind;
  const spec = getSpec(production.format, mediaKind);
  const isReel = production.format === 'reel';
  const sending = progress !== null;
  const renderedOutput =
    production.origin === 'pipeline' &&
    !!production.final_asset &&
    production.version !== null;

  useEffect(() => {
    if (open) {
      setTab('upload');
      setFile(null);
      setFileProblem(null);
      setPicked(null);
      setCover(null);
      setCoverProblem(null);
      setProgress(null);
      setRejection([]);
    }
  }, [open]);

  const chooseFile = (next: File) => {
    setRejection([]);
    let problem = precheckFile(next, 'final');
    const ext = next.name.split('.').pop()?.toLowerCase() ?? '';
    if (!problem && !KIND_RULES[mediaKind].extensions.includes(ext)) {
      problem = `This item needs ${mediaKind === 'video' ? 'a video (MP4 or MOV)' : 'an image (JPG, PNG or WebP)'}.`;
    }
    setFile(next);
    setFileProblem(problem);
  };

  const chooseCover = (next: File) => {
    const ext = next.name.split('.').pop()?.toLowerCase() ?? '';
    setCover(next);
    setCoverProblem(
      KIND_RULES.image.extensions.includes(ext)
        ? null
        : 'The cover must be an image (JPG, PNG or WebP).',
    );
  };

  const ready =
    !sending &&
    !coverProblem &&
    (tab === 'upload' ? !!file && !fileProblem : !!picked);

  const submit = async () => {
    let rights: RightsFormValues = RIGHTS_DEFAULTS;
    if (tab === 'upload') {
      try {
        rights = await form.validateFields();
      } catch {
        return;
      }
    }
    setRejection([]);
    setProgress(0);
    try {
      const next = await uploadFinalAsset(
        item.id,
        {
          base_version: production.version ?? undefined,
          ...(tab === 'upload' && file
            ? { file, ...toRightsFields(rights) }
            : { asset_id: picked?.id }),
          cover: isReel && cover ? cover : undefined,
        },
        setProgress,
      );
      setProduction(next);
      if (next.active_job) onJobStarted(next.active_job);
      const needsWork = next.render_warnings.some(
        (w) => w.code === 'final_needs_normalising',
      );
      message.success(
        needsWork
          ? 'File accepted. It needs adjusting; see the warning in the preview.'
          : 'File accepted',
      );
      reload();
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'unsupported_media') {
        const reasons = rejectionReasons(error.details, {
          kind: mediaKind,
          formatPlural: FORMAT_PLURAL[production.format],
        });
        setRejection(reasons.length ? reasons : [errorText(error)]);
      } else if (isApiError(error) && error.code === 'validation_error') {
        setRejection(
          error.fields.map((field) => field.message || fieldErrorText(field)),
        );
      } else if (isApiError(error) && error.code === 'payload_too_large') {
        setRejection(['The file is larger than the upload limit.']);
      } else {
        handleError(error);
        if (
          isApiError(error) &&
          (error.code === 'version_conflict' ||
            error.code === 'job_in_progress')
        )
          onClose();
      }
    } finally {
      setProgress(null);
    }
  };

  const uploadTab = (
    <Flex vertical gap={token.margin}>
      <Upload.Dragger
        accept={KIND_RULES[mediaKind].extensions
          .map((ext) => `.${ext}`)
          .join(',')}
        fileList={[]}
        showUploadList={false}
        multiple={false}
        disabled={sending}
        beforeUpload={(next) => {
          chooseFile(next as File);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined aria-hidden />
        </p>
        <p className="ant-upload-text">
          {file
            ? file.name
            : `Drop the finished ${mediaKind} here or click to choose`}
        </p>
      </Upload.Dragger>
      {fileProblem ? (
        <Typography.Text type="danger">{fileProblem}</Typography.Text>
      ) : null}
      <Form<RightsFormValues>
        form={form}
        layout="vertical"
        initialValues={RIGHTS_DEFAULTS}
        requiredMark={false}
      >
        <RightsFormFields form={form} disabled={sending} />
      </Form>
    </Flex>
  );

  return (
    <Modal
      open={open}
      title="Use my own file"
      onCancel={sending ? undefined : onClose}
      width={720}
      destroyOnHidden
      footer={
        <Flex justify="end" gap={token.marginXS}>
          <Button onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            type="primary"
            onClick={submit}
            disabled={!ready}
            loading={sending}
          >
            Use this file
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap={token.margin}>
        {spec ? (
          <Typography.Text type="secondary">
            {requirementsLine(spec)}
          </Typography.Text>
        ) : null}
        {renderedOutput ? (
          <Alert
            type="warning"
            showIcon
            title={`This replaces the rendered ${mediaKind} in version ${production.version}. To go back, start production again.`}
          />
        ) : null}
        <Tabs
          activeKey={tab}
          onChange={(key) => {
            setTab(key as 'upload' | 'library');
            setRejection([]);
          }}
          items={[
            { key: 'upload', label: 'Upload', children: uploadTab },
            {
              key: 'library',
              label: 'From library',
              children: (
                <Flex vertical gap={token.marginSM}>
                  {picked ? (
                    <Typography.Text>
                      Selected: {picked.original_filename}
                    </Typography.Text>
                  ) : null}
                  <AssetBrowser
                    accountId={accountId}
                    kind={mediaKind}
                    uploadRole="final"
                    contentItemId={item.id}
                    selectedId={picked?.id ?? null}
                    onPick={(asset) => {
                      setPicked(asset);
                      setRejection([]);
                    }}
                    allowUpload={false}
                  />
                </Flex>
              ),
            },
          ]}
        />
        {isReel ? (
          <Flex vertical gap={token.marginXXS}>
            <Typography.Text strong>Cover image</Typography.Text>
            <Flex gap={token.marginXS} align="center" wrap>
              <Upload
                accept={KIND_RULES.image.extensions
                  .map((ext) => `.${ext}`)
                  .join(',')}
                fileList={[]}
                showUploadList={false}
                disabled={sending}
                beforeUpload={(next) => {
                  chooseCover(next as File);
                  return false;
                }}
              >
                <Button icon={<PictureOutlined />} disabled={sending}>
                  {cover ? 'Change cover' : 'Choose cover'}
                </Button>
              </Upload>
              {cover ? (
                <>
                  <Typography.Text>{cover.name}</Typography.Text>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setCover(null);
                      setCoverProblem(null);
                    }}
                    disabled={sending}
                  >
                    Remove
                  </Button>
                </>
              ) : null}
            </Flex>
            {coverProblem ? (
              <Typography.Text type="danger">{coverProblem}</Typography.Text>
            ) : null}
            <Typography.Text type="secondary">
              Without a cover, the frame at 1 second is used.
            </Typography.Text>
          </Flex>
        ) : null}
        {progress !== null ? (
          <Progress
            percent={progress}
            size="small"
            aria-label="Upload progress"
          />
        ) : null}
        {rejection.length > 0 ? (
          <Alert
            type="error"
            showIcon
            title="This file can't be used"
            description={
              <ul style={{ margin: 0, paddingInlineStart: token.paddingLG }}>
                {rejection.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            }
          />
        ) : null}
      </Flex>
    </Modal>
  );
};

export default UploadFinalModal;
