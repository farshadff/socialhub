import {
  Checkbox,
  Form,
  Input,
  Modal,
  message,
  notification,
  Typography,
} from 'antd';
import React, { useState } from 'react';
import { formatDateTime } from '@/components/DateTime';
import {
  type ContentItemDetail,
  type ContentItemSummary,
  cancelContentItem,
} from '@/services/socialhub/content';
import { isApiError } from '@/services/socialhub/http';
import { useCurrentAccount } from '@/utils/accountRequest';
import { notifyError } from '@/utils/errorText';

type Values = { reason: string; release_candidate: boolean };

export type CancelItemModalProps = {
  item: Pick<ContentItemSummary, 'id' | 'title' | 'slot' | 'candidate'> | null;
  open: boolean;
  onClose: () => void;
  onCancelled: (item: ContentItemDetail) => void;
};

/** "Cancel item" (E03-S04 Cancel flow). */
const CancelItemModal: React.FC<CancelItemModalProps> = ({
  item,
  open,
  onClose,
  onCancelled,
}) => {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const { account } = useCurrentAccount();
  const zone = account?.timezone ?? 'UTC';

  const submit = async () => {
    if (!item) return;
    let values: Values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const cancelled = await cancelContentItem(item.id, {
        reason: values.reason.trim(),
        release_candidate: Boolean(values.release_candidate),
      });
      message.success('Item cancelled');
      form.resetFields();
      onCancelled(cancelled);
    } catch (error) {
      if (
        isApiError(error) &&
        error.code === 'invalid_transition' &&
        error.details.reason === 'publishing_in_progress'
      ) {
        notification.warning({
          title:
            'This item is being published right now. Try again in a minute.',
        });
      } else if (isApiError(error) && error.code === 'validation_error') {
        form.setFields(
          error.fields
            .filter((field) => field.path === 'reason')
            .map(() => ({
              name: 'reason',
              errors: ['Give a reason of 3 to 500 characters.'],
            })),
        );
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={item ? `Cancel “${item.title}”?` : 'Cancel item?'}
      open={open && item !== null}
      onCancel={onClose}
      onOk={submit}
      okText="Cancel item"
      okButtonProps={{ danger: true, loading: saving }}
      cancelText="Keep item"
      destroyOnHidden
      afterClose={() => form.resetFields()}
    >
      <Typography.Paragraph>
        {item?.slot
          ? `The slot on ${formatDateTime(item.slot.scheduled_at, zone)} becomes open again. This cannot be undone.`
          : 'This cannot be undone.'}
      </Typography.Paragraph>
      <Form<Values>
        form={form}
        layout="vertical"
        initialValues={{ reason: '', release_candidate: false }}
        preserve={false}
      >
        <Form.Item
          name="reason"
          label="Reason"
          rules={[
            { required: true, whitespace: true, message: 'Give a reason.' },
            { min: 3, message: 'Use at least 3 characters.' },
            { max: 500, message: 'Use at most 500 characters.' },
          ]}
        >
          <Input.TextArea rows={3} showCount maxLength={500} autoFocus />
        </Form.Item>
        {item?.candidate ? (
          <Form.Item
            name="release_candidate"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Checkbox>
              Return the idea to the candidates so it can be selected again
            </Checkbox>
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
};

export default CancelItemModal;
