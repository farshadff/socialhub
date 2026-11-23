import { LockOutlined } from '@ant-design/icons';
import {
  ProCard,
  ProForm,
  ProFormRadio,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Form, message, Tooltip, theme } from 'antd';
import React, { useState } from 'react';
import type {
  Account,
  AccountUpdate,
  ContentLanguage,
} from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import { useIsAdmin } from '@/utils/accountRequest';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import { useUnsavedChangesGuard } from '@/utils/unsavedChanges';
import {
  accountKeys,
  HANDLE_HELP,
  handleRule,
  LANGUAGE_OPTIONS,
  normalizeHandle,
  timeZoneOptions,
  WEEKDAY_OPTIONS,
} from '../shared';
import { useAccountUpdate } from './useAccountUpdate';

type Values = {
  handle: string;
  display_name: string;
  timezone: string;
  content_language: ContentLanguage;
  week_start_day: number;
  notes: string;
};

const NEW_PLANS_ONLY = 'Changes apply to new plans only.';
const HANDLE_LOCKED_CONNECTED = 'Disconnect the account to change its handle';
const HANDLE_LOCKED_OPERATOR = 'Only admins can change the handle';

const valuesFrom = (account: Account): Values => ({
  handle: account.handle,
  display_name: account.display_name,
  timezone: account.timezone,
  content_language: account.content_language,
  week_start_day: account.week_start_day,
  notes: account.notes ?? '',
});

/** Only the fields that changed, so an operator never sends an admin-only field (rule 10). */
export function profileChanges(
  account: Account,
  values: Values,
): AccountUpdate {
  const body: AccountUpdate = {};
  const handle = normalizeHandle(values.handle);
  if (handle && handle !== account.handle) body.handle = handle;
  const displayName = values.display_name.trim();
  if (displayName !== account.display_name) body.display_name = displayName;
  if (values.timezone !== account.timezone) body.timezone = values.timezone;
  if (values.content_language !== account.content_language) {
    body.content_language = values.content_language;
  }
  if (values.week_start_day !== account.week_start_day) {
    body.week_start_day = values.week_start_day;
  }
  if ((values.notes ?? '') !== (account.notes ?? ''))
    body.notes = values.notes ?? '';
  return body;
}

/** Profile tab (E00-S03 FE2). */
const ProfileTab: React.FC<{ account: Account }> = ({ account }) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm<Values>();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const save = useAccountUpdate(account.id);
  const [dirty, setDirty] = useState(false);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  useUnsavedChangesGuard(dirty);

  const handleEditable =
    isAdmin && account.connection_status === 'disconnected';
  const lockReason = isAdmin ? HANDLE_LOCKED_CONNECTED : HANDLE_LOCKED_OPERATOR;

  const onFinish = async (values: Values) => {
    setFormErrors([]);
    const body = profileChanges(account, values);
    if (!Object.keys(body).length) {
      setDirty(false);
      message.success('Account saved');
      return true;
    }
    try {
      const saved = await save(body);
      form.setFieldsValue(valuesFrom(saved));
      setDirty(false);
      message.success('Account saved');
      return true;
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        setFormErrors(applyFieldErrors(form, error));
      } else if (isApiError(error) && error.code === 'invalid_transition') {
        // Rule 3: the handle is locked once the account is connected.
        form.setFields([{ name: 'handle', errors: [HANDLE_LOCKED_CONNECTED] }]);
        queryClient.invalidateQueries({
          queryKey: accountKeys.account(account.id),
        });
      } else {
        notifyError(error);
      }
      return false;
    }
  };

  return (
    <ProCard>
      {formErrors.length ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.margin }}
          title={formErrors.join(' ')}
        />
      ) : null}
      <ProForm<Values>
        form={form}
        layout="vertical"
        style={{ maxWidth: 640 }}
        initialValues={valuesFrom(account)}
        onValuesChange={() => setDirty(true)}
        onFinish={onFinish}
        submitter={{
          searchConfig: { submitText: 'Save changes' },
          resetButtonProps: { style: { display: 'none' } },
        }}
      >
        <ProFormText
          name="handle"
          label="Instagram handle"
          extra={handleEditable ? HANDLE_HELP : undefined}
          rules={
            handleEditable
              ? [{ required: true, message: 'This is required.' }, handleRule]
              : []
          }
          fieldProps={{
            prefix: '@',
            readOnly: !handleEditable,
            'aria-readonly': !handleEditable,
            suffix: handleEditable ? null : (
              <Tooltip title={lockReason}>
                <LockOutlined aria-label={lockReason} />
              </Tooltip>
            ),
          }}
        />
        <ProFormText
          name="display_name"
          label="Display name"
          fieldProps={{ maxLength: 80 }}
          rules={[
            { required: true, whitespace: true, message: 'This is required.' },
          ]}
        />
        <ProFormSelect
          name="timezone"
          label="Timezone"
          showSearch
          allowClear={false}
          extra={NEW_PLANS_ONLY}
          options={timeZoneOptions(account.timezone)}
          rules={[{ required: true, message: 'This is required.' }]}
        />
        <ProFormRadio.Group
          name="content_language"
          label="Content language"
          options={LANGUAGE_OPTIONS}
        />
        <ProFormSelect
          name="week_start_day"
          label="First day of the week"
          allowClear={false}
          extra={NEW_PLANS_ONLY}
          options={WEEKDAY_OPTIONS}
        />
        <ProFormTextArea
          name="notes"
          label="Notes"
          fieldProps={{
            maxLength: 1000,
            showCount: true,
            rows: 4,
            dir: 'auto',
          }}
        />
      </ProForm>
    </ProCard>
  );
};

export default ProfileTab;
