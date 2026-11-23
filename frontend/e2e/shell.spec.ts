import { expect, test } from '@playwright/test';
import { requirePassword, signIn } from './helpers';

/** The sidebar in E00-S02 rule 7, in order, with the page title each item opens. */
const NAVIGATION: [string, string, string][] = [
  ['Overview', '/overview', 'Overview'],
  ['Weekly plan', '/plans', 'Weekly plan'],
  ['Research', '/research', 'Research'],
  ['Selection', '/selection', 'Selection'],
  ['Content', '/content', 'Content'],
  ['Review', '/review', 'Review'],
  ['Calendar', '/calendar', 'Calendar'],
  ['Posts', '/analytics/posts', 'Posts'],
  ['Account', '/analytics/account', 'Account'],
  ['Reports', '/reports', 'Reports'],
  ['Library', '/library', 'Library'],
  ['Accounts', '/settings/accounts', 'Accounts'],
  ['System', '/settings/system', 'System'],
];

const TOP_LEVEL = [
  'Overview',
  'Weekly plan',
  'Research',
  'Selection',
  'Content',
  'Review',
  'Calendar',
  'Analytics',
  'Reports',
  'Library',
  'Settings',
];

const OLD_TEMPLATE_URLS = [
  '/welcome',
  '/dashboard/analysis',
  '/form/basic-form',
  '/list/table-list',
  '/profile/basic',
  '/account/center',
  '/chatbot',
  '/user/register',
];

test.describe('Panel shell (E00-S02)', () => {
  test.beforeEach(() => requirePassword());

  test('admin: sidebar order, every page and its tab title', async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, 'admin');
    const sider = page.locator('.ant-pro-sider');
    const labels = await sider
      .locator('.ant-menu-root > li > .ant-menu-title-content, .ant-menu-root > li > .ant-menu-submenu-title .ant-menu-title-content')
      .allInnerTexts();
    expect(labels.map((label) => label.trim())).toEqual(TOP_LEVEL);

    for (const [, path, title] of NAVIGATION) {
      await page.goto(path);
      await expect(page).toHaveTitle(`${title} · Social Hub`);
    }
  });

  test('operator: no System item and the 403 page on direct navigation', async ({
    page,
  }) => {
    await signIn(page, 'operator');
    await page.getByRole('menuitem', { name: /Settings/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'System' })).toHaveCount(0);
    await page.goto('/settings/system');
    await expect(
      page.getByText("You don't have permission to see this page."),
    ).toBeVisible();
  });

  test('old template URLs show the 404 page', async ({ page }) => {
    await signIn(page, 'admin');
    for (const path of OLD_TEMPLATE_URLS) {
      await page.goto(path);
      await expect(page.getByText("We couldn't find that page.")).toBeVisible();
    }
  });

  test('keyboard: the top bar and menu are reachable with visible focus', async ({
    page,
  }) => {
    await signIn(page, 'admin');
    const reached = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          name: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
          visible:
            style.outlineStyle !== 'none' ||
            style.boxShadow !== 'none' ||
            el.matches(':focus-visible'),
        };
      });
      if (info?.name) {
        reached.add(info.name);
        expect(info.visible, `focus visible on "${info.name}"`).toBe(true);
      }
    }
    expect([...reached].some((name) => name.includes('Weekly plan'))).toBe(
      true,
    );
  });
});
