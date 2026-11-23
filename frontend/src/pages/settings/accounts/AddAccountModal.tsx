import {
  ModalForm,
  ProFormRadio,
  ProFormSelect,
  ProFormText,
} from '@ant-design/pro-components';
import { history, useModel } from '@umijs/max';
import { Alert, Form, message, theme } from 'antd';
import React, { useState } from 'react';
import {
  type AccountCreate,
  type ContentLanguage,
  createAccount,
} from '@/services/socialhub/accounts';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { notifyError } from '@/utils/errorText';
import {
  browserTimeZone,
  DEFAULT_WEEK_START,
  HANDLE_HELP,
  handleRule,
  LANGUAGE_OPTIONS,
  normalizeHandle,
  timeZoneOptions,
  WEEKDAY_OPTIONS,
} from './shared';

type Values = {
  handle: string;
  display_name: string;
  timezone: string;
  content_language: ContentLanguage;
  week_start_day: number;
};

export type AddAccountModalProps = {
  trigger: React.ReactElement;
};

/**
 * "Add account" (E00-S03 Panel). On success: "Account added", the account model refreshes, the
 * new account becomes current, and the browser goes to its Brand tab.
 */
const AddAccountModal: React.FC<AddAccountModalProps> = ({ trigger }) => {
  const [form] = Form.useForm<Values>();
  const { token } = theme.useToken();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const { currentAccount, refreshAccounts, setCurrentAccount } =
    useModel('account');
  const defaultZone = currentAccount?.timezone ?? browserTimeZone();

  const onFinish = async (values: Values) => {
    setFormErrors([]);
    const body: AccountCreate = {
      handle: normalizeHandle(values.handle),
      display_name: values.display_name.trim(),
      timezone: values.timezone,
      content_language: values.content_language,
      week_start_day: values.week_start_day,
    };
    try {
      const account = await createAccount(body);
      message.success('Account added');
      await refreshAccounts();
      setCurrentAccount(account.id);
      history.push(`/settings/accounts/${account.id}?tab=brand`);
      return true;
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_error') {
        setFormErrors(applyFieldErrors(form, error));
      } else {
        notifyError(error);
      }
      return false;
    }
  };

  return (
    <ModalForm<Values>
      title="Add account"
      trigger={trigger}
      form={form}
      width={520}
      modalProps={{ destroyOnHidden: true }}
      initialValues={{
        timezone: defaultZone,
        content_language: 'fa',
        week_start_day: DEFAULT_WEEK_START,
      }}
      submitter={{ searchConfig: { submitText: 'Add account' } }}
      onOpenChange={(open) => {
        if (!open) setFormErrors([]);
      }}
      onFinish={onFinish}
    >
      {formErrors.length ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: token.margin }}
          title={formErrors.join(' ')}
        />
      ) : null}
      <ProFormText
        name="handle"
        label="Instagram handle"
        extra={HANDLE_HELP}
        fieldProps={{ prefix: '@', autoComplete: 'off' }}
        rules={[{ required: true, message: 'This is required.' }, handleRule]}
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
        options={timeZoneOptions(defaultZone)}
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
        options={WEEKDAY_OPTIONS}
        allowClear={false}
      />
    </ModalForm>
  );
};

export default AddAccountModal;
