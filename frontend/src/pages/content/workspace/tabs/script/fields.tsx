import { contentFontFamily } from '@root/config/theme';
import { Form, Input, Tooltip, theme } from 'antd';
import type { InputProps } from 'antd';
import type { TextAreaProps } from 'antd/es/input';
import React from 'react';
import { useCurrentAccount } from '@/utils/accountRequest';
import { charCount, fieldDomId } from './scriptModel';

/** How the editor's fields look right now: disabled (with why), and per-path status and errors. */
export type FieldState = {
  disabled: boolean;
  /** Tooltip on disabled fields, for example the running job's message. */
  lockReason?: React.ReactNode;
  status: (path: string) => 'error' | 'warning' | undefined;
  error: (path: string) => string | undefined;
};

export function useContentLang(): 'fa' | 'en' {
  const { account } = useCurrentAccount();
  return account?.content_language === 'en' ? 'en' : 'fa';
}

/** Wraps a disabled control so its reason shows on hover and focus. */
export const LockTooltip: React.FC<{
  reason?: React.ReactNode;
  children: React.ReactElement;
}> = ({ reason, children }) =>
  reason ? (
    <Tooltip title={reason}>
      <span style={{ display: 'block' }}>{children}</span>
    </Tooltip>
  ) : (
    children
  );

export type FieldProps = {
  path: string;
  label: React.ReactNode;
  state: FieldState;
  required?: boolean;
  extra?: React.ReactNode;
  children: React.ReactElement;
};

/** A labelled field: label bound to the control's id, API error under it, issue status. */
export const Field: React.FC<FieldProps> = ({ path, label, state, required, extra, children }) => {
  const { token } = theme.useToken();
  const error = state.error(path);
  const status = state.status(path);
  return (
    <Form.Item
      label={label}
      htmlFor={fieldDomId(path)}
      required={required}
      validateStatus={status}
      help={error}
      extra={extra}
      style={{ marginBottom: token.marginSM }}
    >
      <LockTooltip reason={state.disabled ? state.lockReason : undefined}>{children}</LockTooltip>
    </Form.Item>
  );
};

type ContentInputBase = { path: string; max?: number; lang: 'fa' | 'en' };

const counter = (max?: number) =>
  max === undefined ? undefined : { show: true, max, strategy: charCount };

/** A single-line input for content: `dir="auto"`, content font, `n/limit` counter that never blocks typing. */
export const ContentInput: React.FC<ContentInputBase & Omit<InputProps, 'id' | 'lang'>> = ({
  path,
  max,
  lang,
  style,
  ...rest
}) => (
  <Input
    id={fieldDomId(path)}
    dir="auto"
    lang={lang}
    count={counter(max)}
    style={{ fontFamily: contentFontFamily[lang], ...style }}
    {...rest}
  />
);

export const ContentTextArea: React.FC<
  ContentInputBase & Omit<TextAreaProps, 'id' | 'lang'>
> = ({ path, max, lang, style, ...rest }) => (
  <Input.TextArea
    id={fieldDomId(path)}
    dir="auto"
    lang={lang}
    count={counter(max)}
    style={{ fontFamily: contentFontFamily[lang], ...style }}
    {...rest}
  />
);
