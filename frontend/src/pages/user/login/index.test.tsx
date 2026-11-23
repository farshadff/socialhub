import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ApiError } from '@/services/socialhub/http';

const mocks = vi.hoisted(() => ({
  getCsrf: vi.fn(),
  login: vi.fn(),
  replace: vi.fn(),
  setInitialState: vi.fn(),
  initialState: { currentUser: undefined as any },
}));

vi.mock('@umijs/max', () => ({
  Helmet: ({ children }: any) => <>{children}</>,
  Navigate: ({ to }: any) => <div>Redirected to {to}</div>,
  history: { replace: mocks.replace },
  useModel: () => ({
    initialState: mocks.initialState,
    setInitialState: mocks.setInitialState,
  }),
}));

vi.mock('@/services/socialhub/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/socialhub/auth')>()),
  getCsrf: mocks.getCsrf,
  login: mocks.login,
}));

vi.mock('@/utils/session', async () => ({
  HOME_PATH: '/overview',
  sessionStarted: vi.fn(),
  getSafeRedirectUrl: (redirect: string | null) =>
    redirect?.startsWith('/') && !redirect.startsWith('//')
      ? redirect
      : '/overview',
}));

import Login, { rateLimitText } from './index';

const apiError = (status: number, code: string, retryAfter?: number) =>
  new ApiError(
    status,
    { code, message: '…', request_id: 'r1' },
    { retryAfter: retryAfter ?? null },
  );

const user = {
  id: 3,
  username: 'sara',
  full_name: 'Sara Moradi',
  email: 'sara@example.com',
  role: 'operator' as const,
};

async function submit(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByLabelText('Username').fill('sara');
  await screen.getByLabelText('Password').fill('secret');
  await screen.getByRole('button', { name: 'Sign in' }).click();
}

describe('Sign-in page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initialState.currentUser = undefined;
    mocks.getCsrf.mockResolvedValue({ csrf_token: 't' });
    window.history.replaceState(null, '', '/user/login');
  });

  it('shows the product, two fields and one button', async () => {
    const screen = await render(<Login />);
    await expect.element(screen.getByText('Social Hub')).toBeInTheDocument();
    await expect
      .element(screen.getByText('Sign in to continue'))
      .toBeInTheDocument();
    await expect.element(screen.getByLabelText('Username')).toHaveFocus();
    await expect
      .element(screen.getByLabelText('Password'))
      .toHaveAttribute('autocomplete', 'current-password');
    expect(mocks.getCsrf).toHaveBeenCalledTimes(1);
  });

  it('asks for both fields', async () => {
    const screen = await render(<Login />);
    await screen.getByRole('button', { name: 'Sign in' }).click();
    await expect
      .element(screen.getByText('Enter your username'))
      .toBeInTheDocument();
    await expect
      .element(screen.getByText('Enter your password'))
      .toBeInTheDocument();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('offers Retry when the server cannot be reached', async () => {
    mocks.getCsrf.mockRejectedValueOnce(apiError(0, 'network_error'));
    const screen = await render(<Login />);
    await expect
      .element(
        screen.getByText(
          "Can't reach the server. Check your connection and try again.",
        ),
      )
      .toBeInTheDocument();
    await screen.getByRole('button', { name: 'Retry' }).click();
    expect(mocks.getCsrf).toHaveBeenCalledTimes(2);
  });

  it('signs in and goes to the safe redirect', async () => {
    window.history.replaceState(null, '', '/user/login?redirect=%2Fplans%2F7');
    mocks.login.mockResolvedValue({ user, csrf_token: 'n' });
    const screen = await render(<Login />);
    await submit(screen);
    await expect.poll(() => mocks.replace.mock.calls.length).toBe(1);
    expect(mocks.login).toHaveBeenCalledWith({
      username: 'sara',
      password: 'secret',
    });
    expect(mocks.replace).toHaveBeenCalledWith('/plans/7');
    expect(mocks.setInitialState).toHaveBeenCalled();
  });

  it('goes to /overview without a redirect', async () => {
    mocks.login.mockResolvedValue({ user, csrf_token: 'n' });
    const screen = await render(<Login />);
    await submit(screen);
    await expect.poll(() => mocks.replace.mock.calls[0]?.[0]).toBe('/overview');
  });

  it('shows wrong credentials and clears the password', async () => {
    mocks.login.mockRejectedValue(apiError(400, 'invalid_credentials'));
    const screen = await render(<Login />);
    await submit(screen);
    await expect
      .element(screen.getByText('Wrong username or password.'))
      .toBeInTheDocument();
    await expect.element(screen.getByLabelText('Password')).toHaveValue('');
    await expect.element(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('shows the wait time and disables the button when rate limited', async () => {
    mocks.login.mockRejectedValue(apiError(429, 'rate_limited', 840));
    const screen = await render(<Login />);
    await submit(screen);
    await expect
      .element(screen.getByText('Too many attempts. Try again in 14 minutes.'))
      .toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: 'Sign in' }))
      .toBeDisabled();
  });

  it('refreshes the CSRF token once and resubmits silently', async () => {
    mocks.login
      .mockRejectedValueOnce(apiError(403, 'csrf_failed'))
      .mockResolvedValueOnce({ user, csrf_token: 'n' });
    const screen = await render(<Login />);
    await submit(screen);
    await expect.poll(() => mocks.replace.mock.calls.length).toBe(1);
    expect(mocks.getCsrf).toHaveBeenCalledTimes(2);
    expect(mocks.login).toHaveBeenCalledTimes(2);
  });

  it('asks for a reload when the CSRF token fails twice', async () => {
    mocks.login.mockRejectedValue(apiError(403, 'csrf_failed'));
    const screen = await render(<Login />);
    await submit(screen);
    await expect
      .element(screen.getByText('Your session expired. Reload the page.'))
      .toBeInTheDocument();
    expect(mocks.login).toHaveBeenCalledTimes(2);
  });

  it('sends a signed-in visitor to /overview', async () => {
    mocks.initialState.currentUser = { id: 1 };
    const screen = await render(<Login />);
    await expect
      .element(screen.getByText('Redirected to /overview'))
      .toBeInTheDocument();
  });

  it('words the wait in minutes', () => {
    expect(rateLimitText(60)).toBe('Too many attempts. Try again in 1 minute.');
    expect(rateLimitText(61)).toBe('Too many attempts. Try again in 2 minutes.');
  });
});
