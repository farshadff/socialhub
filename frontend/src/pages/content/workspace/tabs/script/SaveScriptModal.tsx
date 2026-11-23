import { ModalForm, ProFormTextArea } from '@ant-design/pro-components';
import { Form } from 'antd';
import React from 'react';
import { SCRIPT_LIMITS } from '@/services/socialhub/scripts';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { charCount } from './scriptModel';

export type SaveScriptModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Runs the save. Resolves true when the modal should close; a rejected `note` error is put under
   * the field and keeps it open.
   */
  onSave: (note: string) => Promise<boolean>;
};

/** "Save as new version": one optional note (E05-S02 Actions). */
const SaveScriptModal: React.FC<SaveScriptModalProps> = ({ open, onOpenChange, onSave }) => {
  const [form] = Form.useForm<{ note?: string }>();
  return (
    <ModalForm<{ note?: string }>
      title="Save as new version"
      form={form}
      open={open}
      width={480}
      onOpenChange={onOpenChange}
      modalProps={{ destroyOnHidden: true }}
      submitter={{ searchConfig: { submitText: 'Save', resetText: 'Cancel' } }}
      onFinish={async (values) => {
        try {
          return await onSave(values.note ?? '');
        } catch (error) {
          applyFieldErrors(form, error);
          return false;
        }
      }}
    >
      <ProFormTextArea
        name="note"
        label="What changed? (optional)"
        fieldProps={{
          dir: 'auto',
          rows: 3,
          count: { show: true, max: SCRIPT_LIMITS.note, strategy: charCount },
        }}
        rules={[
          {
            validator: async (_rule: unknown, value?: string) => {
              if (value && charCount(value) > SCRIPT_LIMITS.note) {
                throw new Error(`Use at most ${SCRIPT_LIMITS.note} characters.`);
              }
            },
          },
        ]}
      />
    </ModalForm>
  );
};

export default SaveScriptModal;
