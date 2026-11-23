import { ModalForm, ProFormCheckbox, ProFormTextArea } from '@ant-design/pro-components';
import { Alert, Button, Form, message, Typography, theme } from 'antd';
import React, { useState } from 'react';
import { isApiError } from '@/services/socialhub/http';
import type { JobSummary } from '@/services/socialhub/jobs';
import {
  type GenerateScriptBody,
  generateScript,
  SCRIPT_LIMITS,
} from '@/services/socialhub/scripts';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { errorText } from '@/utils/errorText';
import { scriptErrorText } from './constants';
import { charCount } from './scriptModel';

type Values = { feedback?: string; startOver?: boolean };

export type RegenerateScriptModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: number;
  /** The latest version, which the rewrite is based on. */
  version: number;
  /** The editor has unsaved changes. */
  dirty: boolean;
  /** "Save now": runs the save flow; the dialog stays open behind it. */
  onSaveNow: () => void;
  /** Called with the job once it is created (or adopted from `409 job_in_progress`). */
  onStarted: (job: JobSummary, body: GenerateScriptBody) => void;
  /** "Reload" after `409 version_conflict`. */
  onReload: () => unknown;
};

type Problem = { text: string; reload?: boolean };

/** "Regenerate script" with direction for the AI (E05-S03 Regenerate dialog). */
const RegenerateScriptModal: React.FC<RegenerateScriptModalProps> = ({
  open,
  onOpenChange,
  itemId,
  version,
  dirty,
  onSaveNow,
  onStarted,
  onReload,
}) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm<Values>();
  const feedback = Form.useWatch('feedback', form) ?? '';
  const startOver = Form.useWatch('startOver', form) ?? false;
  const [problem, setProblem] = useState<Problem | null>(null);
  const canSubmit = startOver || feedback.trim().length > 0;

  const submit = async (values: Values) => {
    setProblem(null);
    const text = (values.feedback ?? '').trim();
    try {
      // Start over: a fresh script from the brief; the feedback is direction only.
      const body: GenerateScriptBody = values.startOver
        ? { start_over: true, base_version: version, ...(text ? { feedback: text } : {}) }
        : { feedback: text, base_version: version };
      const { job } = await generateScript(itemId, body);
      onStarted(job, body);
      return true;
    } catch (error) {
      if (!isApiError(error)) {
        setProblem({ text: errorText(error) });
        return false;
      }
      if (error.code === 'version_conflict') {
        setProblem({ text: 'Someone saved a newer version. Reload and try again.', reload: true });
      } else if (error.code === 'job_in_progress' && error.details.job) {
        message.info('Already running. Showing its progress.');
        onStarted(error.details.job as JobSummary, {});
        return true;
      } else if (error.code === 'validation_error') {
        const unmatched = applyFieldErrors(form, error);
        if (unmatched.length) setProblem({ text: unmatched.join(' ') });
      } else {
        setProblem({ text: scriptErrorText(error.code) ?? errorText(error) });
      }
      return false;
    }
  };

  return (
    <ModalForm<Values>
      title="Regenerate script"
      form={form}
      open={open}
      width={560}
      onOpenChange={(next) => {
        if (!next) setProblem(null);
        onOpenChange(next);
      }}
      modalProps={{ destroyOnHidden: true }}
      submitter={{
        searchConfig: { submitText: 'Regenerate', resetText: 'Cancel' },
        submitButtonProps: { disabled: !canSubmit },
      }}
      onFinish={submit}
    >
      <Typography.Paragraph>
        {`The AI rewrites version ${version} using your direction. The current version is kept in history.`}
      </Typography.Paragraph>
      {dirty ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: token.margin }}
          title="You have unsaved changes. Save them first, or they will not be part of the rewrite."
          action={
            <Button size="small" type="link" onClick={onSaveNow}>
              Save now
            </Button>
          }
        />
      ) : null}
      <ProFormTextArea
        name="feedback"
        label="What should change?"
        placeholder="For example: open with a question; drop the second statistic; make it 20 seconds."
        fieldProps={{
          dir: 'auto',
          rows: 4,
          count: { show: true, max: SCRIPT_LIMITS.feedback, strategy: charCount },
        }}
        rules={[
          {
            validator: async (_rule: unknown, value?: string) => {
              if (value && charCount(value) > SCRIPT_LIMITS.feedback) {
                throw new Error(`Use at most ${SCRIPT_LIMITS.feedback.toLocaleString('en')} characters.`);
              }
            },
          },
        ]}
      />
      <ProFormCheckbox
        name="startOver"
        extra={startOver ? `The new script will not be based on version ${version}.` : undefined}
      >
        Start over from the brief (ignore the current script)
      </ProFormCheckbox>
      {problem ? (
        <Alert
          type="error"
          showIcon
          title={problem.text}
          action={
            problem.reload ? (
              <Button
                size="small"
                onClick={async () => {
                  await onReload();
                  setProblem(null);
                }}
              >
                Reload
              </Button>
            ) : undefined
          }
        />
      ) : null}
    </ModalForm>
  );
};

export default RegenerateScriptModal;
