import { history } from '@umijs/max';
import { message } from 'antd';
import { ERROR_TEXT } from './errorText';
import { queryClient } from './queryClient';

/** Default page after sign-in (DESIGN-SYSTEM.md section 5). */
export const HOME_PATH = '/overview';
export const LOGIN_PATH = '/user/login';

/**
 * Validates a `redirect` value to prevent open redirects: only same-origin relative paths starting
 * with a single `/` are allowed (the template's `getSafeRedirectUrl`, with `/overview` as fallback).
 */
export function getSafeRedirectUrl(
  redirect: string | null | undefined,
  fallback = HOME_PATH,
): string {
  if (!redirect?.startsWith('/') || redirect.startsWith('//')) return fallback;
  try {
    const parsed = new URL(redirect, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.pathname.startsWith('/user/') ? fallback : path;
  } catch {
    return fallback;
  }
}

/** `/user/login?redirect=<path, query and hash>` for the given (default: current) location. */
export function loginPath(
  location: { pathname: string; search?: string; hash?: string } = history
    .location,
): string {
  const target = `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`;
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(target)}`;
}

export const isAuthPath = (pathname: string) => pathname.startsWith('/user/');

type Listener = () => void;
const listeners = new Set<Listener>();
let ending = false;

/** Registers a callback run when the session ends (clears `currentUser` in initial state). */
export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called after a successful sign-in or bootstrap, so a later expiry is handled again. */
export function sessionStarted() {
  ending = false;
}

/**
 * Ends the panel session after `403 authentication_required` (E00-S01): clears cached data and
 * the current user, says why, and goes to sign-in with a redirect back. Runs once per session even
 * when several requests fail together, and never from the sign-in page itself.
 */
export function endSession() {
  if (ending || isAuthPath(history.location.pathname)) return;
  ending = true;
  const target = loginPath();
  queryClient.clear();
  for (const listener of listeners) listener();
  message.warning(ERROR_TEXT.authentication_required);
  history.replace(target);
}
