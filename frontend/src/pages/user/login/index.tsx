import { LockOutlined, UserOutlined } from '@ant-design/icons';
import {
  LoginForm,
  ProFormText,
  type ProFormInstance,
} from '@ant-design/pro-components';
import { Helmet, history, Navigate, useModel } from '@umijs/max';
import { Alert, Button, Card, theme } from 'antd';
import React, { startTransition, useEffect, useRef, useState } from 'react';
import {
  getCsrf,
  type LoginBody,
  login,
  toCurrentUser,
} from '@/services/socialhub/auth';
import { isApiError } from '@/services/socialhub/http';
import { applyFieldErrors } from '@/utils/applyFieldErrors';
import { ERROR_TEXT, errorText } from '@/utils/errorText';
import {
  getSafeRedirectUrl,
  HOME_PATH,
  sessionStarted,
} from '@/utils/session';

/** The sign-in card's width from E00-S01. */
const CARD_MAX_WIDTH = 400;
/** The logo size on the sign-in card from E00-S01. */
const LOGO_SIZE = 48;

const TEXT = {
  unreachable: "Can't reach the server. Check your connection and try again.",
  wrongCredentials: 'Wrong username or password.',
  sessionExpired: 'Your session expired. Reload the page.',
};

/** "Too many attempts. Try again in {n} minutes." from `Retry-After` seconds. */
export function rateLimitText(retryAfterSeconds: number | null): string {
  const minutes = Math.max(1, Math.ceil((retryAfterSeconds ?? 60) / 60));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

type Problem =
  | { kind: 'unreachable' }
  | { kind: 'message'; text: string }
  | { kind: 'list'; texts: string[] };

const Login: React.FC = () => {
  const { token } = theme.useToken();
  const { initialState, setInitialState } = useModel('@@initialState');
  const formRef = useRef<ProFormInstance<LoginBody>>(undefined);
  const [csrfReady, setCsrfReady] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);

  const loadCsrf = async () => {
    setProblem(null);
    try {
      await getCsrf();
      setCsrfReady(true);
    } catch {
      setCsrfReady(false);
      setProblem({ kind: 'unreachable' });
    }
  };

  useEffect(() => {
    loadCsrf();
  }, []);

  // Re-enable the button once the rate-limit window passes.
  useEffect(() => {
    if (blockedUntil === null) return undefined;
    const timer = window.setTimeout(
      () => {
        setBlockedUntil(null);
        setProblem(null);
      },
      Math.max(0, blockedUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [blockedUntil]);

  if (initialState?.currentUser) {
    return <Navigate to={HOME_PATH} replace />;
  }

  const clearAndFocusPassword = () => {
    formRef.current?.setFieldValue('password', '');
    window.setTimeout(() => document.getElementById('password')?.focus(), 0);
  };

  const signIn = async (values: LoginBody) => {
    try {
      return await login(values);
    } catch (error) {
      // Django rotates the CSRF token; fetch a new one once and resubmit silently.
      // A second `csrf_failed` reaches the caller, which shows "Your session expired…".
      if (isApiError(error) && error.code === 'csrf_failed') {
        await getCsrf();
        return login(values);
      }
      throw error;
    }
  };

  const handleSubmit = async (values: LoginBody) => {
    setProblem(null);
    try {
      const { user } = await signIn(values);
      sessionStarted();
      startTransition(() => {
        setInitialState((state) =>
          state ? { ...state, currentUser: toCurrentUser(user) } : state,
        );
      });
      const redirect = new URL(window.location.href).searchParams.get(
        'redirect',
      );
      history.replace(getSafeRedirectUrl(redirect));
    } catch (error) {
      if (!isApiError(error)) {
        setProblem({ kind: 'message', text: errorText(error) });
        return;
      }
      switch (error.code) {
        case 'invalid_credentials':
          setProblem({ kind: 'message', text: TEXT.wrongCredentials });
          clearAndFocusPassword();
          return;
        case 'rate_limited':
          setProblem({ kind: 'message', text: rateLimitText(error.retryAfter) });
          setBlockedUntil(Date.now() + (error.retryAfter ?? 60) * 1000);
          return;
        case 'csrf_failed':
          setProblem({ kind: 'message', text: TEXT.sessionExpired });
          return;
        case 'validation_error': {
          const unmatched = formRef.current
            ? applyFieldErrors(formRef.current, error)
            : [];
          if (unmatched.length) setProblem({ kind: 'list', texts: unmatched });
          return;
        }
        case 'network_error':
          setProblem({ kind: 'unreachable' });
          return;
        default:
          setProblem({
            kind: 'message',
            text: ERROR_TEXT[error.code] ?? errorText(error),
          });
      }
    }
  };

  let alert: React.ReactNode = null;
  if (problem?.kind === 'unreachable') {
    alert = (
      <Alert
        type="error"
        showIcon
        title={TEXT.unreachable}
        action={
          <Button size="small" onClick={loadCsrf}>
            Retry
          </Button>
        }
      />
    );
  } else if (problem?.kind === 'message') {
    alert = <Alert type="error" showIcon title={problem.text} />;
  } else if (problem?.kind === 'list') {
    alert = (
      <Alert type="error" showIcon title={problem.texts.join(' ')} />
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: token.paddingLG,
        background: token.colorBgLayout,
      }}
    >
      <Helmet>
        <title>Sign in · Social Hub</title>
      </Helmet>
      <Card style={{ width: '100%', maxWidth: CARD_MAX_WIDTH }}>
        <LoginForm<LoginBody>
          formRef={formRef}
          contentStyle={{ minWidth: 0, width: '100%' }}
          logo={
            <img
              alt=""
              src="/socialhub.svg"
              width={LOGO_SIZE}
              height={LOGO_SIZE}
            />
          }
          title="Social Hub"
          subTitle="Sign in to continue"
          submitter={{
            searchConfig: { submitText: 'Sign in' },
            submitButtonProps: {
              size: 'large',
              block: true,
              disabled: !csrfReady || blockedUntil !== null,
            },
          }}
          onFinish={async (values) => {
            await handleSubmit(values);
          }}
        >
          {alert ? (
            <div style={{ marginBottom: token.marginLG }}>{alert}</div>
          ) : null}
          <ProFormText
            name="username"
            label="Username"
            fieldProps={{
              size: 'large',
              prefix: <UserOutlined />,
              autoComplete: 'username',
              autoFocus: true,
            }}
            rules={[{ required: true, message: 'Enter your username' }]}
          />
          <ProFormText.Password
            name="password"
            label="Password"
            fieldProps={{
              size: 'large',
              prefix: <LockOutlined />,
              autoComplete: 'current-password',
            }}
            rules={[{ required: true, message: 'Enter your password' }]}
          />
        </LoginForm>
      </Card>
    </div>
  );
};

export default Login;
