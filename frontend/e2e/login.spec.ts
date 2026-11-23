import { expect, test } from '@playwright/test';
import { PASSWORD, requirePassword, signIn } from './helpers';

test.describe('Sign in (E00-S01)', () => {
  test.beforeEach(() => requirePassword());

  test('shows the sign-in card', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/user/login');
    await expect(page.getByText('Sign in to continue')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveTitle('Sign in · Social Hub');
  });

  test('rejects a wrong password', async ({ page }) => {
    await page.goto('/user/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill(`${PASSWORD}-wrong`);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Wrong username or password.')).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveValue('');
  });

  test('signs in, signs out, and returns to a protected page after sign-in', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    await expect(page.getByRole('menuitem', { name: /Overview/ })).toBeVisible();

    await page.getByText('admin', { exact: true }).hover();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/user\/login$/);

    const me = await page.request.get('/api/v1/auth/me/');
    expect(me.status()).toBe(403);

    await page.goto('/calendar');
    await expect(page).toHaveURL(/\/user\/login\?redirect=%2Fcalendar$/);
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/calendar$/);
  });
});
