import { ProCard, ProForm, ProFormDigit } from '@ant-design/pro-components';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Flex,
  Form,
  Modal,
  message,
  Switch,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import React, { useState } from 'react';
import type {
  Account,
  AccountUpdate,
  Autopilot,
  PostingRules,
} from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import { useIsAdmin } from '@/utils/accountRequest';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { useUnsavedChangesGuard } from '@/utils/unsavedChanges';
import { accountKeys, canPublish } from '../shared';
import { useAccountUpdate } from './useAccountUpdate';

export const OPERATOR_NOTE = 'Only admins can change automation settings.';
export const CONNECT_FIRST = 'Connect the account first';

const AUTOPILOT: { key: keyof Autopilot; label: string; help: string }[] = [
  {
    key: 'selection',
    label: 'Confirm selection automatically',
    help: 'Nobody needs to confirm the proposed candidates for the week; they become content items on their own.',
  },
  {
    key: 'brief',
    label: 'Approve briefs automatically',
    help: 'Nobody needs to approve a new brief before the script is written.',
  },
  {
    key: 'script',
    label: 'Approve scripts automatically',
    help: 'Nobody needs to approve a new script before production starts.',
  },
];

/** Rule 8 ranges. */
export const POSTING_RULES: {
  key: keyof PostingRules;
  label: string;
  min: number;
  max: number;
}[] = [
  {
    key: 'min_gap_minutes',
    label: 'Minimum gap between posts (minutes)',
    min: 15,
    max: 1440,
  },
  {
    key: 'max_feed_per_day',
    label: 'Reels and feed posts per day',
    min: 1,
    max: 10,
  },
  { key: 'max_stories_per_day', label: 'Stories per day', min: 1, max: 20 },
  {
    key: 'max_revisions',
    label: 'Automatic revisions before human review',
    min: 0,
    max: 5,
  },
];

type RulesValues = { posting_rules: PostingRules };

type SettingRowProps = {
  label: string;
  help: string;
  control: React.ReactNode;
};

const SettingRow: React.FC<SettingRowProps> = ({ label, help, control }) => {
  const { token } = theme.useToken();
  return (
    <Flex gap={token.margin} align="flex-start">
      {control}
      <Flex vertical>
        <Typography.Text strong>{label}</Typography.Text>
        <Typography.Text type="secondary">{help}</Typography.Text>
      </Flex>
    </Flex>
  );
};

/** Automation tab (E00-S03 FE4): editable for admins, read-only for operators. */
const AutomationTab: React.FC<{ account: Account }> = ({ account }) => {
  const { token } = theme.useToken();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const save = useAccountUpdate(account.id);
  const [pending, setPending] = useState<string | null>(null);
  const [form] = Form.useForm<RulesValues>();
  const [rulesDirty, setRulesDirty] = useState(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  useUnsavedChangesGuard(rulesDirty);

  const handle = `@${account.handle}`;
  const connected = canPublish(account.connection_status);
  const readOnly = !isAdmin;

  /** Switches save at once; a failure shows its notification and reloads the account. */
  const saveSwitch = async (
    key: string,
    body: AccountUpdate,
    success: string,
  ) => {
    setPending(key);
    try {
      await save(body);
      message.success(success);
    } catch (error) {
      notifyError(error);
      queryClient.invalidateQueries({
        queryKey: accountKeys.account(account.id),
      });
    } finally {
      setPending(null);
    }
  };

  const onPublishingChange = (checked: boolean) => {
    if (!checked) {
      saveSwitch(
        'publishing',
        { publishing_enabled: false },
        'Publishing turned off',
      );
      return;
    }
    Modal.confirm({
      title: `Turn on publishing for ${handle}?`,
      content: 'Scheduled posts will be sent to Instagram at their times.',
      okText: 'Turn on publishing',
      onOk: () =>
        saveSwitch(
          'publishing',
          { publishing_enabled: true },
          'Publishing turned on',
        ),
    });
  };

  const publishingDisabled =
    readOnly || pending !== null || (!account.publishing_enabled && !connected);
  const publishingTooltip =
    !account.publishing_enabled && !connected && !readOnly
      ? CONNECT_FIRST
      : undefined;

  const onRulesFinish = async (values: RulesValues) => {
    setFormErrors([]);
    setRulesSaving(true);
    try {
      const saved = await save({ posting_rules: values.posting_rules });
      if (saved.posting_rules) {
        form.setFieldsValue({ posting_rules: saved.posting_rules });
      }
      setRulesDirty(false);
      message.success('Posting rules saved');
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        setFormErrors(applyFieldErrors(form, error));
      } else {
        notifyError(error);
      }
    } finally {
      setRulesSaving(false);
    }
  };

  return (
    <Flex vertical gap={token.margin}>
      {readOnly ? <Alert type="info" showIcon title={OPERATOR_NOTE} /> : null}
      <ProCard title="Publishing" headerBordered>
        <SettingRow
          label="Publish to Instagram"
          help="When off, nothing is sent to Instagram and due posts wait."
          control={
            <Tooltip title={publishingTooltip}>
              {/* A wrapper, because a disabled switch gets no pointer events for the tooltip. */}
              <span
                data-testid="publishing-switch"
                style={{ display: 'inline-flex' }}
              >
                <Switch
                  aria-label="Publish to Instagram"
                  checked={account.publishing_enabled}
                  disabled={publishingDisabled}
                  loading={pending === 'publishing'}
                  onChange={onPublishingChange}
                />
              </span>
            </Tooltip>
          }
        />
      </ProCard>
      <ProCard title="Autopilot" headerBordered>
        <Flex vertical gap={token.margin}>
          {AUTOPILOT.map(({ key, label, help }) => (
            <SettingRow
              key={key}
              label={label}
              help={help}
              control={
                <Switch
                  aria-label={label}
                  checked={account.autopilot[key]}
                  disabled={readOnly || pending !== null}
                  loading={pending === key}
                  onChange={(checked) =>
                    saveSwitch(
                      key,
                      { autopilot: { [key]: checked } },
                      `${label}: ${checked ? 'on' : 'off'}`,
                    )
                  }
                />
              }
            />
          ))}
        </Flex>
      </ProCard>
      <ProCard title="Posting rules" headerBordered>
        {formErrors.length ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: token.margin }}
            title={formErrors.join(' ')}
          />
        ) : null}
        <ProForm<RulesValues>
          form={form}
          layout="vertical"
          style={{ maxWidth: 480 }}
          disabled={readOnly}
          initialValues={{ posting_rules: account.posting_rules }}
          onValuesChange={() => setRulesDirty(true)}
          onFinish={onRulesFinish}
          submitter={
            readOnly
              ? false
              : {
                  searchConfig: { submitText: 'Save rules' },
                  resetButtonProps: { style: { display: 'none' } },
                  submitButtonProps: { loading: rulesSaving },
                }
          }
        >
          {POSTING_RULES.map(({ key, label, min, max }) => (
            <ProFormDigit
              key={key}
              name={['posting_rules', key]}
              label={label}
              min={min}
              max={max}
              fieldProps={{ precision: 0 }}
              extra={`${min.toLocaleString('en')} to ${max.toLocaleString('en')}`}
              rules={[{ required: true, message: 'This is required.' }]}
            />
          ))}
        </ProForm>
      </ProCard>
    </Flex>
  );
};

export default AutomationTab;
