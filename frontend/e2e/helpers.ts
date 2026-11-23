import { expect, type Page, test } from '@playwright/test';

/**
 * E2E runs against the real API (Django behind the dev-server proxy). Seed the users first:
 *   SOCIALHUB_E2E_PASSWORD=… python manage.py seed_users
 * and export the same `SOCIALHUB_E2E_PASSWORD` for Playwright.
 */
export const PASSWORD = process.env.SOCIALHUB_E2E_PASSWORD ?? '';

export function requirePassword() {
  test.skip(!PASSWORD, 'Set SOCIALHUB_E2E_PASSWORD and run `manage.py seed_users`.');
}

export async function signIn(page: Page, username: 'admin' | 'operator') {
  await page.goto('/user/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/overview$/);
}
