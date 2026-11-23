/**
 * Sign-in and session endpoints (E00-S01, docs/epics/E00-foundation/S01-sign-in.md).
 * `/auth/csrf/` and `/auth/login/` are public; the full user object appears only here.
 */
import { api, apiRequest } from './http';

export type Role = 'admin' | 'operator';

/** The full user representation returned by `/auth/*`. */
export type User = {
  id: number;
  username: string;
  /** First and last name joined; falls back to the username. */
  full_name: string;
  email: string;
  role: Role;
};

/** The signed-in user as the panel keeps it in initial state (`access` drives `src/access.ts`). */
export type CurrentUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  access: Role;
};

export type LoginBody = { username: string; password: string };

export const toCurrentUser = (user: User): CurrentUser => ({
  id: user.id,
  name: user.full_name || user.username,
  username: user.username,
  email: user.email,
  access: user.role,
});

/** Sets the `csrftoken` cookie and returns the token. */
export const getCsrf = () => api.get<{ csrf_token: string }>('/auth/csrf/');

/** `400 invalid_credentials`, `400 validation_error`, `429 rate_limited` or `403 csrf_failed` on failure. */
export const login = (body: LoginBody) =>
  api.post<{ user: User; csrf_token: string }>('/auth/login/', body);

/** `204`, also without a session. */
export const logout = () => api.post<void>('/auth/logout/');

/**
 * The current user, or `403 authentication_required` without a session. Called with
 * `skipErrorHandler` so the bootstrap decides the redirect itself (no redirect loop).
 */
export const getMe = () =>
  apiRequest<{ user: User }>('GET', '/auth/me/', { skipErrorHandler: true });
