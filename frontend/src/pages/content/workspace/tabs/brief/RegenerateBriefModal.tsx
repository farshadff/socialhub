import { Form, Input, Modal, message, Typography } from 'antd';
import React, { useState } from 'react';
import { BRIEF_LIMITS, generateBrief } from '@/services/socialhub/briefs';
import { isApiError } from '@/services/socialhub/http';
import { fieldErrorText, notifyError } from '@/utils/errorText';

export type RegenerateBriefModalProps = {
  open: boolean;
  itemId: number;
  /** The version on screen; a newer one makes the server answer `version_conflict`. */
  baseVersion: number;
  onClose: () => void;
  /** Called once the job is accepted (or already running) so the shell starts following it. */
  onStarted: () => void;
  /** Called after a `version_conflict` so the tab reloads the latest version. */
  onConflict: () => void;
};

/** "Regenerate brief" (E04-S03): optional feedback, then a `brief.generate` job. */
const RegenerateBriefModal: React.FC<RegenerateBriefModalProps> = ({
  open,
  itemId,
  baseVersion,
  onClose,
  onStarted,
  onConflict,
}) => {
  const [form] = Form.useForm<{ feedback: string }>();
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const feedback = (form.getFieldValue('feedback') ?? '').trim();
    setSending(true);
    try {
      await generateBrief(itemId, {
        ...(feedback ? { feedback } : {}),
        base_version: baseVersion,
      });
      form.resetFields();
      onClose();
      onStarted();
    } catch (error) {
      if (isApiError(error) && error.code === 'job_in_progress') {
        message.info('Already running. Showing its progress.');
        onClose();
        onStarted();
      } else if (isApiError(error) && error.code === 'version_conflict') {
        message.warning('A newer version exists. We have loaded it; regenerate again if needed.');
        onClose();
        onConflict();
      } else if (isApiError(error) && error.code === 'validation_error') {
        form.setFields([
          {
            name: 'feedback',
            errors: error.fields.map((field) => fieldErrorText(field)),
          },
        ]);
      } else {
        notifyError(error);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Regenerate brief"
      okText="Regenerate"
      onOk={submit}
      confirmLoading={sending}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="feedback" label="What should change? (optional)">
          <Input.TextArea
            dir="auto"
            autoSize={{ minRows: 4, maxRows: 10 }}
            count={{ show: true, max: BRIEF_LIMITS.feedback }}
          />
        </Form.Item>
      </Form>
      <Typography.Text type="secondary">The current version stays in the history.</Typography.Text>
    </Modal>
  );
};

export default RegenerateBriefModal;
