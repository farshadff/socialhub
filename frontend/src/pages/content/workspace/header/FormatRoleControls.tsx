import {
  EditOutlined,
  LockOutlined,
  MobileOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@umijs/max';
import {
  Alert,
  Button,
  Form,
  Modal,
  message,
  Radio,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import DateTime, { formatDateTime } from '@/components/DateTime';
import RolePicker from '@/pages/content/shared/RolePicker';
import useFormats from '@/pages/content/shared/useFormats';
import {
  type ContentItemDetail,
  listPlanSlots,
  updateContentItem,
} from '@/services/socialhub/content';
import type { Format, MediaKind } from '@/services/socialhub/formats';
import { isApiError } from '@/services/socialhub/http';
import { useCurrentAccount } from '@/utils/accountRequest';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import {
  changedFields,
  consequenceOf,
  type FormatRoleValues,
  fillCombination,
  initialValues,
  isBookable,
  preselectSlot,
  type SlotOption,
  slotMismatch,
} from './formatRoleLogic';

export type FormatRoleControlsProps = {
  item: ContentItemDetail;
  reload: () => unknown;
  /** Opens the modal whenever this number changes (the Brief tab's "Change" link). */
  openRequest?: number;
};

const FORMAT_ICON: Record<Format, React.ReactNode> = {
  reel: <VideoCameraOutlined />,
  story: <MobileOutlined />,
  feed_post: <PictureOutlined />,
};

const FORMAT_ORDER: Format[] = ['reel', 'story', 'feed_post'];
const PAST_SCRIPTED = new Set([
  'in_production',
  'in_check',
  'needs_revision',
  'in_review',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
]);
const NO_SLOT = 0;

function confirmReplace(): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: 'Replace the brief and script?',
      okText: 'Replace and save',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * The header's format, production mode and role control (E04-S02): an "Edit" button that opens
 * the "Format and role" modal when `edit_format` is allowed.
 */
const FormatRoleControls: React.FC<FormatRoleControlsProps> = ({ item, reload, openRequest }) => {
  const { modeLabel } = useFormats();
  const [open, setOpen] = useState(false);
  const allowed = item.allowed_actions.includes('edit_format');
  const lastRequest = useRef(openRequest);

  useEffect(() => {
    if (openRequest === undefined || openRequest === lastRequest.current) return;
    lastRequest.current = openRequest;
    if (allowed) setOpen(true);
  }, [openRequest, allowed]);

  const mode = (
    <Typography.Text type="secondary">{modeLabel(item.production_mode)}</Typography.Text>
  );

  if (!allowed) {
    if (!PAST_SCRIPTED.has(item.status)) return mode;
    return (
      <Space size={4}>
        {mode}
        <Tooltip title="Format is fixed once production starts">
          <LockOutlined aria-label="Format is fixed once production starts" tabIndex={0} />
        </Tooltip>
      </Space>
    );
  }

  return (
    <Space size={4}>
      {mode}
      <Button
        size="small"
        icon={<EditOutlined />}
        aria-label="Edit format and role"
        onClick={() => setOpen(true)}
      >
        Edit
      </Button>
      {open ? (
        <FormatRoleModal item={item} reload={reload} onClose={() => setOpen(false)} />
      ) : null}
    </Space>
  );
};

type FormValues = Omit<FormatRoleValues, 'slot'> & { slot: number };

const FormatRoleModal: React.FC<{
  item: ContentItemDetail;
  reload: () => unknown;
  onClose: () => void;
}> = ({ item, reload, onClose }) => {
  const { token } = theme.useToken();
  const { data: registry, loading, formatLabel, modesFor } = useFormats();
  const { account } = useCurrentAccount();
  const tz = account?.timezone ?? 'UTC';
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string[]>([]);
  const [serverSlots, setServerSlots] = useState<SlotOption[] | null>(null);

  const start = initialValues(item);
  const watched = Form.useWatch([], form) as FormValues | undefined;
  const values: FormatRoleValues = watched
    ? { ...start, ...watched, slot: watched.slot === NO_SLOT ? null : (watched.slot ?? null) }
    : start;

  const planId = item.plan?.id ?? null;
  const planClosed = item.plan?.status === 'closed';

  const slotsQuery = useQuery({
    queryKey: [item.account, 'plan-slots', planId, 'open', values.format],
    enabled: planId !== null && !planClosed,
    queryFn: () =>
      listPlanSlots(planId as number, { status: ['open'], format: [values.format] }),
  });

  const slotOptions: SlotOption[] = useMemo(() => {
    if (serverSlots && values.format !== item.format) {
      return serverSlots;
    }
    const open = (slotsQuery.data?.results ?? [])
      .filter((s) => s.format === values.format && isBookable(s.scheduled_at))
      .map((s) => ({ id: s.id, scheduled_at: s.scheduled_at, role: s.role }));
    // The item's own slot is reserved, not open; keep it selectable while the format matches.
    if (item.slot && item.slot.format === values.format && !open.some((o) => o.id === item.slot?.id)) {
      open.unshift({ id: item.slot.id, scheduled_at: item.slot.scheduled_at, role: item.slot.role });
    }
    return open.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }, [serverSlots, slotsQuery.data, values.format, item.format, item.slot]);

  const mustMoveSlot = slotMismatch(item.slot, values.format);

  // Rule 12: when the format changes and the current slot no longer fits, pre-select a new one.
  const preselectedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!mustMoveSlot || slotsQuery.isLoading) return;
    const key = `${values.format}:${slotOptions.map((o) => o.id).join(',')}`;
    if (preselectedFor.current === key) return;
    preselectedFor.current = key;
    form.setFieldValue('slot', preselectSlot(slotOptions, values.role) ?? NO_SLOT);
  }, [mustMoveSlot, slotsQuery.isLoading, slotOptions, values.format, values.role, form]);

  const onValuesChange = (changed: Partial<FormValues>, all: FormValues) => {
    if ('format' in changed || 'media_kind' in changed) {
      const filled = fillCombination(registry, all);
      form.setFieldsValue(filled);
      if ('format' in changed && changed.format === item.format && item.slot) {
        form.setFieldValue('slot', item.slot.id);
      }
    }
  };

  const slotLabel = (slotId: number) => {
    const slot = slotOptions.find((s) => s.id === slotId);
    return slot ? formatDateTime(slot.scheduled_at, tz) : `slot ${slotId}`;
  };
  const consequence = consequenceOf(item, values, slotLabel);
  const modes = modesFor(values.format, values.media_kind);
  const formatName = formatLabel(values.format).toLowerCase();

  const submit = async (confirmed: boolean): Promise<void> => {
    const change = changedFields(item, values);
    if (Object.keys(change).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setFormError([]);
    try {
      const result = await updateContentItem(item.id, {
        ...change,
        ...(confirmed ? { confirm: true } : {}),
      });
      message.success('Saved');
      onClose();
      await reload();
      if (result.effects?.status_to === 'selected') message.info('Writing a new brief…');
    } catch (error) {
      if (!isApiError(error)) {
        notifyError(error);
        return;
      }
      if (error.code === 'job_in_progress') {
        onClose();
        message.warning('Wait for the running step to finish.');
        reload();
        return;
      }
      if (error.status === 409) {
        notifyError(error);
        onClose();
        reload();
        return;
      }
      if (error.fields.some((f) => f.code === 'confirmation_required')) {
        if (await confirmReplace()) await submit(true);
        return;
      }
      const openSlots = error.details.open_slots as SlotOption[] | undefined;
      if (Array.isArray(openSlots)) {
        setServerSlots(openSlots);
        form.setFieldValue('slot', preselectSlot(openSlots, values.role) ?? NO_SLOT);
      }
      const unmatched = applyFieldErrors(form, error);
      setFormError(unmatched);
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    if (consequence?.type === 'warning') {
      if (await confirmReplace()) await submit(true);
      return;
    }
    await submit(false);
  };

  const slotsLoading = planId !== null && !planClosed && slotsQuery.isLoading;

  return (
    <Modal
      open
      title="Format and role"
      width={640}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button
          key="save"
          type="primary"
          loading={saving}
          disabled={loading || slotsLoading}
          onClick={onSave}
        >
          Save
        </Button>,
      ]}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{ ...start, slot: start.slot ?? NO_SLOT }}
          onValuesChange={onValuesChange}
          requiredMark={false}
        >
          {formError.length > 0 ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: token.margin }}
              title={formError.join(' ')}
            />
          ) : null}
          <Form.Item name="format" label="Format">
            <Radio.Group optionType="button" buttonStyle="solid">
              {FORMAT_ORDER.map((format) => (
                <Radio.Button key={format} value={format}>
                  <Space size={token.marginXXS}>
                    {FORMAT_ICON[format]}
                    {formatLabel(format)}
                  </Space>
                </Radio.Button>
              ))}
            </Radio.Group>
          </Form.Item>
          {values.format === 'story' ? (
            <Form.Item name="media_kind" label="Media">
              <Segmented<MediaKind>
                options={[
                  { label: 'Image', value: 'image' },
                  { label: 'Video', value: 'video' },
                ]}
              />
            </Form.Item>
          ) : null}
          {modes.length > 1 ? (
            <Form.Item name="production_mode" label="Production mode">
              <Radio.Group style={{ width: '100%' }}>
                <Space orientation="vertical" size={token.marginXS}>
                  {modes.map((mode) => {
                    const info = registry?.production_modes.find((m) => m.key === mode);
                    return (
                      <Radio key={mode} value={mode}>
                        <Space orientation="vertical" size={0}>
                          <span>{info?.label ?? mode}</span>
                          {info?.description ? (
                            <Typography.Text type="secondary">{info.description}</Typography.Text>
                          ) : null}
                        </Space>
                      </Radio>
                    );
                  })}
                </Space>
              </Radio.Group>
            </Form.Item>
          ) : (
            <Form.Item label="Production mode">
              <Typography.Text type="secondary">Made as a design</Typography.Text>
            </Form.Item>
          )}
          <Form.Item name="role" label="Role">
            <RolePicker
              format={values.format}
              allowClear={!item.current_brief || item.current_brief.status === 'superseded'}
            />
          </Form.Item>
          <Form.Item
            name="slot"
            label="Slot"
            required={mustMoveSlot}
            extra={
              planClosed ? (
                'The plan is closed'
              ) : !slotsLoading && slotOptions.length === 0 && planId !== null ? (
                <Space size={token.marginXS}>
                  <span>No open {formatName} slot this week</span>
                  <Link to={`/plans/${planId}?tab=slots`}>Add a slot</Link>
                </Space>
              ) : undefined
            }
          >
            <Select
              loading={slotsLoading}
              disabled={planClosed || planId === null}
              options={[
                ...slotOptions.map((slot) => ({
                  value: slot.id,
                  label: (
                    <Space size={token.marginXS}>
                      <DateTime value={slot.scheduled_at} />
                      <Typography.Text type="secondary">
                        {slot.role
                          ? (registry?.roles?.find((r) => r.key === slot.role)?.label ?? slot.role)
                          : 'Any role'}
                      </Typography.Text>
                    </Space>
                  ),
                })),
                { value: NO_SLOT, label: 'No slot' },
              ]}
            />
          </Form.Item>
          {consequence ? (
            <Alert type={consequence.type} showIcon title={consequence.text} />
          ) : null}
        </Form>
      )}
    </Modal>
  );
};

export default FormatRoleControls;
