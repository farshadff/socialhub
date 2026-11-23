import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  InboxOutlined,
  InfoCircleFilled,
} from '@ant-design/icons';
import {
  Button,
  Checkbox,
  DatePicker,
  Flex,
  Form,
  type FormInstance,
  Input,
  List,
  Modal,
  Progress,
  Radio,
  Select,
  Typography,
  theme,
  Upload,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import React, { useEffect, useRef, useState } from 'react';
import {
  type Asset,
  formatBytes,
  KIND_RULES,
  precheckFile,
  ROLE_KINDS,
  ROLE_LABEL,
  type RightsStatus,
  rejectionReasons,
  type UploadFields,
  type UploadRole,
  uploadAsset,
} from '@/services/socialhub/assets';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { errorText } from '@/utils/errorText';

// Shared rights form (E06-S01 AssetUploader table), reused by "Use my own file" (E06-S07).

export type RightsFormValues = {
  origin: 'uploaded' | 'licensed';
  may_use: boolean;
  license_note?: string;
  source_url?: string;
  rights_expires_at?: Dayjs | null;
};

export const RIGHTS_DEFAULTS: RightsFormValues = {
  origin: 'uploaded',
  may_use: false,
};

/** Turns the shared form into upload fields. `rights_status` is always sent explicitly. */
export function toRightsFields(
  values: RightsFormValues,
): Pick<
  UploadFields,
  | 'origin'
  | 'rights_status'
  | 'license_note'
  | 'source_url'
  | 'rights_expires_at'
> {
  const licensed = values.origin === 'licensed';
  const status: RightsStatus = values.may_use ? 'cleared' : 'unknown';
  return {
    origin: values.origin,
    rights_status: status,
    license_note: values.license_note?.trim() || undefined,
    source_url: licensed ? values.source_url?.trim() || undefined : undefined,
    rights_expires_at:
      licensed && values.rights_expires_at
        ? values.rights_expires_at.format('YYYY-MM-DD')
        : undefined,
  };
}

/** The rights fields, inside a parent `Form` whose values include `RightsFormValues`. */
export const RightsFormFields: React.FC<{
  form: FormInstance;
  disabled?: boolean;
}> = ({ form, disabled }) => {
  const { token } = theme.useToken();
  const origin = Form.useWatch('origin', form) as
    | RightsFormValues['origin']
    | undefined;
  const mayUse = Form.useWatch('may_use', form) as boolean | undefined;
  const licensed = origin === 'licensed';
  return (
    <>
      <Form.Item name="origin" label="Where it comes from">
        <Radio.Group
          disabled={disabled}
          onChange={(event) =>
            form.setFieldValue('may_use', event.target.value === 'licensed')
          }
          options={[
            { value: 'uploaded', label: 'We made it or own it' },
            { value: 'licensed', label: 'Licensed from someone else' },
          ]}
        />
      </Form.Item>
      <Form.Item
        name="may_use"
        valuePropName="checked"
        style={{ marginBottom: token.marginXS }}
      >
        <Checkbox disabled={disabled}>We may use this on Instagram</Checkbox>
      </Form.Item>
      <Form.Item
        name="license_note"
        label="Licence note"
        dependencies={['may_use']}
        rules={[
          {
            validator: async (_, value: string | undefined) => {
              if (
                form.getFieldValue('may_use') &&
                (value ?? '').trim().length < 3
              ) {
                throw new Error(
                  'Add a licence note of at least 3 characters, for example "Shot in-house".',
                );
              }
            },
          },
        ]}
        extra={mayUse ? 'Required when we may use it.' : undefined}
      >
        <Input.TextArea
          disabled={disabled}
          autoSize={{ minRows: 2, maxRows: 4 }}
          placeholder="For example: Shot in-house by our team"
        />
      </Form.Item>
      {licensed ? (
        <>
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
            <Input disabled={disabled} placeholder="https://" inputMode="url" />
          </Form.Item>
          <Form.Item name="rights_expires_at" label="Rights expire on">
            <DatePicker
              disabled={disabled}
              format="D MMM YYYY"
              disabledDate={(date) => date.isBefore(dayjs(), 'day')}
            />
          </Form.Item>
        </>
      ) : null}
    </>
  );
};

// The uploader modal.

type EntryStatus = 'waiting' | 'uploading' | 'done' | 'duplicate' | 'rejected';

type QueueEntry = {
  uid: string;
  file: File;
  status: EntryStatus;
  progress: number;
  reasons: string[];
  /** True when the reasons come from the client-side check (re-run when the role changes). */
  precheck: boolean;
  asset?: Asset;
};

export type AssetUploaderProps = {
  open: boolean;
  accountId: number;
  /** Attach the uploads to this item; omit for library assets. */
  contentItemId?: number | null;
  /** Preset for "Use as" (library: Source). */
  defaultRole?: UploadRole;
  /** Roles offered in "Use as"; defaults to every upload role. */
  roles?: UploadRole[];
  title?: string;
  /** Called by Done (and Cancel) with the assets uploaded in this session. */
  onClose: (uploaded: Asset[]) => void;
};

const ALL_ROLES: UploadRole[] = [
  'source',
  'background',
  'clip',
  'music',
  'final',
];

type UploaderValues = RightsFormValues & { role: UploadRole };

let uidCounter = 0;

/**
 * Multi-file upload with one shared rights form (E06-S01). Files go one at a time with their
 * own progress; client-side checks reject obvious mistakes before anything is sent.
 */
const AssetUploader: React.FC<AssetUploaderProps> = ({
  open,
  accountId,
  contentItemId,
  defaultRole = 'source',
  roles = ALL_ROLES,
  title = 'Upload files',
  onClose,
}) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm<UploaderValues>();
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const role =
    (Form.useWatch('role', form) as UploadRole | undefined) ?? defaultRole;

  useEffect(() => {
    if (open) {
      setQueue([]);
      setFormError(null);
    }
  }, [open]);

  // Re-run the client checks when the role changes, so "Use as" mistakes show at once.
  useEffect(() => {
    setQueue((entries) =>
      entries.map((entry) => {
        const recheck =
          entry.status === 'waiting' ||
          (entry.status === 'rejected' && entry.precheck);
        if (!recheck) return entry;
        const reason = precheckFile(entry.file, role);
        return reason
          ? { ...entry, status: 'rejected', reasons: [reason], precheck: true }
          : { ...entry, status: 'waiting', reasons: [], precheck: false };
      }),
    );
  }, [role]);

  const uploaded = queue
    .filter((entry) => entry.asset)
    .map((entry) => entry.asset as Asset);
  const waiting = queue.filter((entry) => entry.status === 'waiting');
  const finished = queue.length > 0 && waiting.length === 0 && !running;

  const accept = Array.from(
    new Set(
      roles
        .flatMap((r) => ROLE_KINDS[r])
        .flatMap((kind) => KIND_RULES[kind].extensions),
    ),
  )
    .map((ext) => `.${ext}`)
    .join(',');

  const addFile = (file: File) => {
    const reason = precheckFile(file, role);
    uidCounter += 1;
    const entry: QueueEntry = {
      uid: `upload-${uidCounter}`,
      file,
      status: reason ? 'rejected' : 'waiting',
      progress: 0,
      reasons: reason ? [reason] : [],
      precheck: !!reason,
    };
    setQueue((entries) => [...entries, entry]);
  };

  const update = (uid: string, change: Partial<QueueEntry>) =>
    setQueue((entries) =>
      entries.map((entry) =>
        entry.uid === uid ? { ...entry, ...change } : entry,
      ),
    );

  const start = async () => {
    let values: UploaderValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setFormError(null);
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    const fields: UploadFields = {
      account: accountId,
      content_item: contentItemId ?? undefined,
      role: values.role,
      ...toRightsFields(values),
    };
    for (const entry of waiting) {
      if (controller.signal.aborted) break;
      update(entry.uid, { status: 'uploading', progress: 0 });
      try {
        const asset = await uploadAsset(
          entry.file,
          fields,
          (percent) => update(entry.uid, { progress: percent }),
          controller.signal,
        );
        update(entry.uid, {
          status: asset.duplicate ? 'duplicate' : 'done',
          progress: 100,
          asset,
        });
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          update(entry.uid, { status: 'waiting', progress: 0 });
          break;
        }
        if (isApiError(error) && error.code === 'validation_error') {
          // A shared-form problem fails every file the same way: stop and show it on the form.
          const unmatched = applyFieldErrors(form, error);
          update(entry.uid, { status: 'waiting', progress: 0 });
          setFormError(
            unmatched[0] ?? 'Check the fields above, then upload again.',
          );
          break;
        }
        let reasons: string[] = [];
        if (isApiError(error) && error.code === 'unsupported_media') {
          reasons = rejectionReasons(error.details);
          if (reasons.length === 0)
            reasons = ["This file can't be used. Check its type and size."];
        } else if (isApiError(error) && error.code === 'payload_too_large') {
          reasons = ['The file is larger than the limit for its type.'];
        } else {
          reasons = [errorText(error)];
        }
        update(entry.uid, { status: 'rejected', reasons, precheck: false });
      }
    }
    abort.current = null;
    setRunning(false);
  };

  const close = () => {
    abort.current?.abort();
    onClose(uploaded);
  };

  const statusLine = (entry: QueueEntry): React.ReactNode => {
    switch (entry.status) {
      case 'uploading':
        return (
          <Progress
            percent={entry.progress}
            size="small"
            aria-label={`Uploading ${entry.file.name}`}
          />
        );
      case 'done':
        return (
          <Typography.Text type="success">
            <CheckCircleFilled aria-hidden /> Uploaded
          </Typography.Text>
        );
      case 'duplicate':
        return (
          <Typography.Text type="secondary">
            <InfoCircleFilled aria-hidden style={{ color: token.colorInfo }} />{' '}
            Already in the library
          </Typography.Text>
        );
      case 'rejected':
        return (
          <Flex vertical>
            {entry.reasons.map((reason) => (
              <Typography.Text key={reason} type="danger">
                <CloseCircleFilled aria-hidden /> {reason}
              </Typography.Text>
            ))}
          </Flex>
        );
      default:
        return (
          <Typography.Text type="secondary">Ready to upload</Typography.Text>
        );
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={close}
      destroyOnHidden
      mask={{ closable: !running }}
      footer={
        <Flex justify="end" gap={token.marginXS}>
          <Button type={finished ? 'primary' : 'default'} onClick={close}>
            Done
          </Button>
          {finished ? null : (
            <Button
              type="primary"
              onClick={start}
              loading={running}
              disabled={waiting.length === 0}
            >
              {waiting.length > 1 ? `Upload ${waiting.length} files` : 'Upload'}
            </Button>
          )}
        </Flex>
      }
    >
      <Flex vertical gap={token.margin}>
        <Upload.Dragger
          multiple
          accept={accept}
          fileList={[]}
          showUploadList={false}
          disabled={running}
          beforeUpload={(file) => {
            addFile(file as File);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined aria-hidden />
          </p>
          <p className="ant-upload-text">Drop files here or click to choose</p>
          <p className="ant-upload-hint">
            Images up to 20 MB, video up to 500 MB, audio up to 30 MB, PDF up to
            20 MB.
          </p>
        </Upload.Dragger>

        {queue.length > 0 ? (
          <List
            size="small"
            bordered
            dataSource={queue}
            renderItem={(entry) => (
              <List.Item
                actions={
                  entry.status === 'waiting' || entry.status === 'rejected'
                    ? [
                        <Button
                          key="remove"
                          type="text"
                          size="small"
                          icon={<CloseOutlined />}
                          aria-label={`Remove ${entry.file.name}`}
                          disabled={running}
                          onClick={() =>
                            setQueue((entries) =>
                              entries.filter((e) => e.uid !== entry.uid),
                            )
                          }
                        />,
                      ]
                    : undefined
                }
              >
                <Flex
                  vertical
                  style={{ width: '100%', minWidth: 0 }}
                  gap={token.marginXXS}
                >
                  <Flex justify="space-between" gap={token.marginXS}>
                    <Typography.Text ellipsis={{ tooltip: entry.file.name }}>
                      {entry.file.name}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ flex: 'none' }}>
                      {formatBytes(entry.file.size)}
                    </Typography.Text>
                  </Flex>
                  {statusLine(entry)}
                </Flex>
              </List.Item>
            )}
          />
        ) : null}

        <Form<UploaderValues>
          form={form}
          layout="vertical"
          initialValues={{ ...RIGHTS_DEFAULTS, role: defaultRole }}
          requiredMark={false}
        >
          <Form.Item name="role" label="Use as">
            <Select
              disabled={running || roles.length === 1}
              options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            />
          </Form.Item>
          <RightsFormFields form={form} disabled={running} />
          {formError ? (
            <Typography.Text type="danger">{formError}</Typography.Text>
          ) : null}
        </Form>
      </Flex>
    </Modal>
  );
};

export default AssetUploader;
