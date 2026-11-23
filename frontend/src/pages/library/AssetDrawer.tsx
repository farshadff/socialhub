import {
  DeleteOutlined,
  DownloadOutlined,
  FilePdfOutlined,
} from '@ant-design/icons';
import { ProDescriptions } from '@ant-design/pro-components';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Modal,
  message,
  notification,
  Select,
  Skeleton,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import React, { useEffect, useState } from 'react';
import DateTime from '@/components/DateTime';
import PageError from '@/components/PageError';
import RightsTag from '@/pages/content/shared/RightsTag';
import { confirmDiscard } from '@/pages/content/shared/leaveGuard';
import {
  type AssetDetail,
  type AssetRightsChange,
  type AssetUsage,
  deleteAsset,
  formatBytes,
  formatDuration,
  getAsset,
  KIND_LABEL,
  ORIGIN_LABEL,
  ROLE_KINDS,
  ROLE_LABEL,
  type RightsStatus,
  type UploadRole,
  updateAsset,
} from '@/services/socialhub/assets';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';

const RIGHTS_OPTIONS: { value: RightsStatus; label: string }[] = [
  { value: 'cleared', label: 'Cleared' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'expired', label: 'Expired' },
];

/** How a version uses the asset (`used_by[].as`). */
const USAGE_LABEL: Record<string, string> = {
  final_asset: 'Final asset',
  cover_asset: 'Cover',
  music_asset: 'Music',
  frame: 'Frame',
  frames: 'Frame',
  background: 'Background',
  background_asset: 'Background',
  clip: 'Clip',
  clips: 'Clip',
};

export function usageLabel(as: string): string {
  const key = as.split('.')[0];
  if (USAGE_LABEL[as]) return USAGE_LABEL[as];
  if (USAGE_LABEL[key]) return USAGE_LABEL[key];
  const words = as.replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Number of distinct items an asset is used in. */
export function itemCount(usedBy: AssetUsage[] | undefined): number {
  return new Set((usedBy ?? []).map((usage) => usage.content_item)).size;
}

/** "Used in 1 item" / "Used in 3 items" (E06-S01 delete guard). */
export function usedInText(count: number): string {
  return `Used in ${count} ${count === 1 ? 'item' : 'items'}`;
}

type FormValues = {
  role?: UploadRole;
  rights_status: RightsStatus;
  license_note: string;
  source_url: string;
  rights_expires_at: Dayjs | null;
};

function toFormValues(asset: AssetDetail): FormValues {
  return {
    role: asset.role in ROLE_KINDS ? (asset.role as UploadRole) : undefined,
    rights_status: asset.rights_status,
    license_note: asset.license_note ?? '',
    source_url: asset.source_url ?? '',
    rights_expires_at: asset.rights_expires_at
      ? dayjs(asset.rights_expires_at)
      : null,
  };
}

const Preview: React.FC<{ asset: AssetDetail }> = ({ asset }) => {
  const { token } = theme.useToken();
  const frame: React.CSSProperties = {
    width: '100%',
    maxHeight: 320,
    objectFit: 'contain',
    display: 'block',
    borderRadius: token.borderRadius,
    background: token.colorFillTertiary,
  };
  switch (asset.kind) {
    case 'image':
      return (
        <img src={asset.url} alt={asset.original_filename} style={frame} />
      );
    case 'video':
      return (
        // biome-ignore lint/a11y/useMediaCaption: library clips carry no caption track
        <video
          src={asset.url}
          poster={asset.thumbnail_url ?? undefined}
          controls
          preload="metadata"
          aria-label={`Video ${asset.original_filename}`}
          style={frame}
        />
      );
    case 'audio':
      return (
        // biome-ignore lint/a11y/useMediaCaption: music has no caption track
        <audio
          src={asset.url}
          controls
          preload="metadata"
          aria-label={`Audio ${asset.original_filename}`}
          style={{ width: '100%' }}
        />
      );
    default:
      return (
        <a href={asset.url} target="_blank" rel="noopener noreferrer">
          <FilePdfOutlined aria-hidden /> Open {asset.original_filename}
        </a>
      );
  }
};

export type AssetDrawerProps = {
  accountId: number;
  assetId: number | null;
  onClose: () => void;
  /** Called after a save or delete so the list refreshes. */
  onChanged: () => void;
};

/** Asset detail (E06-S01 FE4): preview, facts, rights form, "Used in", save, download, delete. */
const AssetDrawer: React.FC<AssetDrawerProps> = ({
  accountId,
  assetId,
  onClose,
  onChanged,
}) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm<FormValues>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [accountId, 'asset', assetId],
    queryFn: () => getAsset(assetId as number),
    enabled: assetId !== null,
  });
  const asset = query.data;

  useEffect(() => {
    if (asset) {
      form.setFieldsValue(toFormValues(asset));
      setDirty(false);
      setFormError(null);
    }
  }, [asset]);

  const systemMade =
    asset?.origin === 'ai_generated' || asset?.origin === 'rendered';
  const roleOptions = asset
    ? (Object.keys(ROLE_KINDS) as UploadRole[])
        .filter((role) => ROLE_KINDS[role].includes(asset.kind))
        .map((role) => ({ value: role, label: ROLE_LABEL[role] }))
    : [];

  const close = async () => {
    if (
      dirty &&
      !(await confirmDiscard(
        'Discard your changes to this asset?',
        'Discard changes',
      ))
    ) {
      return;
    }
    setDirty(false);
    onClose();
  };

  const save = async () => {
    if (!asset) return;
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const change: AssetRightsChange = {
      license_note: values.license_note.trim(),
    };
    if (!systemMade) {
      if (values.role && values.role !== asset.role) change.role = values.role;
      change.rights_status = values.rights_status;
      change.source_url = values.source_url.trim();
      change.rights_expires_at = values.rights_expires_at
        ? values.rights_expires_at.format('YYYY-MM-DD')
        : null;
    }
    setSaving(true);
    setFormError(null);
    try {
      await updateAsset(asset.id, change);
      message.success('Changes saved');
      setDirty(false);
      await query.refetch();
      onChanged();
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        const unmatched = applyFieldErrors(form, error);
        if (unmatched.length) setFormError(unmatched.join(' '));
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!asset) return;
    Modal.confirm({
      title: `Delete ${asset.original_filename}? This cannot be undone.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAsset(asset.id);
          message.success('Asset deleted');
          setDirty(false);
          onChanged();
          onClose();
        } catch (error) {
          if (isApiError(error) && error.code === 'state_conflict') {
            const count = itemCount(
              error.details.used_by as AssetUsage[] | undefined,
            );
            notification.error({
              title: "This asset can't be deleted",
              description: `${usedInText(Math.max(count, 1))}. Remove it from there first.`,
            });
            query.refetch();
          } else {
            notifyError(error);
          }
        }
      },
    });
  };

  const usedCount = Math.max(itemCount(asset?.used_by), asset?.in_use ? 1 : 0);

  let body: React.ReactNode;
  if (query.isLoading) {
    body = <Skeleton active paragraph={{ rows: 10 }} />;
  } else if (query.error) {
    body = <PageError error={query.error} onRetry={() => query.refetch()} />;
  } else if (asset) {
    body = (
      <Flex vertical gap={token.marginLG}>
        <Preview asset={asset} />
        <ProDescriptions<AssetDetail>
          column={1}
          size="small"
          dataSource={asset}
          columns={[
            {
              title: 'File name',
              dataIndex: 'original_filename',
              copyable: true,
            },
            { title: 'Kind', render: () => KIND_LABEL[asset.kind] },
            { title: 'File type', dataIndex: 'mime' },
            { title: 'Size', render: () => formatBytes(asset.bytes) },
            ...(asset.width && asset.height
              ? [
                  {
                    title: 'Dimensions',
                    render: () => `${asset.width} × ${asset.height}`,
                  },
                ]
              : []),
            ...(asset.duration_ms
              ? [
                  {
                    title: 'Duration',
                    render: () => formatDuration(asset.duration_ms),
                  },
                ]
              : []),
            { title: 'Origin', render: () => ORIGIN_LABEL[asset.origin] },
            {
              title: 'Rights',
              render: () => (
                <RightsTag
                  status={asset.rights_status}
                  licenseNote={asset.license_note}
                  expiresAt={asset.rights_expires_at}
                />
              ),
            },
            {
              title: 'Added',
              render: () => (
                <span>
                  <DateTime value={asset.created_at} />
                  {asset.created_by ? ` by ${asset.created_by.name}` : ''}
                </span>
              ),
            },
          ]}
        />

        <div>
          <Typography.Title level={5}>Usage rights</Typography.Title>
          {systemMade ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: token.margin }}
              title="Social Hub made this file, so only its licence note can be changed."
            />
          ) : null}
          <Form<FormValues>
            form={form}
            layout="vertical"
            requiredMark={false}
            disabled={saving}
            onValuesChange={() => setDirty(true)}
          >
            {roleOptions.length > 0 ? (
              <Form.Item name="role" label="Role">
                <Select
                  options={roleOptions}
                  disabled={systemMade}
                  placeholder={ROLE_LABEL[asset.role]}
                />
              </Form.Item>
            ) : null}
            <Form.Item name="rights_status" label="Rights status">
              <Select options={RIGHTS_OPTIONS} disabled={systemMade} />
            </Form.Item>
            <Form.Item
              name="license_note"
              label="Licence note"
              dependencies={['rights_status']}
              rules={[
                {
                  validator: async (_, value: string | undefined) => {
                    if (
                      !systemMade &&
                      form.getFieldValue('rights_status') === 'cleared' &&
                      (value ?? '').trim().length < 3
                    ) {
                      throw new Error(
                        'Add a licence note of at least 3 characters to mark it cleared.',
                      );
                    }
                  },
                },
              ]}
            >
              <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} />
            </Form.Item>
            <Form.Item
              name="source_url"
              label="Source URL"
              rules={[
                {
                  type: 'url',
                  message: 'Enter a full web address, starting with https://',
                },
              ]}
            >
              <Input
                disabled={systemMade}
                placeholder="https://"
                inputMode="url"
              />
            </Form.Item>
            <Form.Item name="rights_expires_at" label="Expiry date">
              <DatePicker disabled={systemMade} format="D MMM YYYY" />
            </Form.Item>
            {formError ? (
              <Typography.Text type="danger">{formError}</Typography.Text>
            ) : null}
          </Form>
        </div>

        <div>
          <Typography.Title level={5}>Used in</Typography.Title>
          {asset.used_by.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Not used in any item."
            />
          ) : (
            <List
              size="small"
              dataSource={asset.used_by}
              renderItem={(usage) => (
                <List.Item>
                  <Flex vertical>
                    <Link to={`/content/${usage.content_item}`}>
                      {usage.title || `Item ${usage.content_item}`}
                    </Link>
                    <Typography.Text type="secondary">
                      Version {usage.version} · {usageLabel(usage.as)}
                    </Typography.Text>
                  </Flex>
                </List.Item>
              )}
            />
          )}
        </div>
      </Flex>
    );
  }

  return (
    <Drawer
      open={assetId !== null}
      onClose={close}
      size={560}
      title={asset?.original_filename ?? 'Asset'}
      destroyOnHidden
      footer={
        asset ? (
          <Flex justify="space-between" gap={token.marginXS}>
            <Tooltip title={asset.in_use ? usedInText(usedCount) : undefined}>
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={asset.in_use}
                onClick={remove}
              >
                Delete
              </Button>
            </Tooltip>
            <Flex gap={token.marginXS}>
              <Button
                icon={<DownloadOutlined />}
                href={asset.url}
                download={asset.original_filename}
                target="_blank"
                rel="noopener noreferrer"
              >
                Download
              </Button>
              <Button
                type="primary"
                onClick={save}
                loading={saving}
                disabled={!dirty}
              >
                Save
              </Button>
            </Flex>
          </Flex>
        ) : null
      }
    >
      {body}
    </Drawer>
  );
};

export default AssetDrawer;
