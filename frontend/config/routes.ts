/**
 * Social Hub route tree: the navigation map in docs/DESIGN-SYSTEM.md section 5 and
 * docs/epics/E00-foundation/S02-panel-shell.md rules 7–11.
 *
 * - Sidebar order follows the weekly workflow. Labels come from `src/locales/en-US/menu.ts`
 *   (`menu.<name>`, nested as `menu.<group>.<name>`); icons are Ant Design icon names.
 * - Detail routes are hidden from the menu; Pro layout highlights their parent by path prefix.
 * - A route whose page belongs to a later story renders `PlaceholderPage` from its own page file;
 *   that story replaces the file's contents.
 */

export default [
  {
    path: '/user',
    layout: false,
    routes: [
      { path: '/user', redirect: '/user/login' },
      { path: '/user/login', name: 'login', component: './user/login' },
      { path: '/user/*', component: './exception/404' },
    ],
  },
  { path: '/', redirect: '/overview' },
  {
    path: '/overview',
    name: 'overview',
    icon: 'dashboard',
    component: './overview',
  },
  {
    path: '/plans',
    name: 'plans',
    icon: 'schedule',
    component: './plans',
  },
  {
    path: '/plans/:planId',
    name: 'plan',
    hideInMenu: true,
    component: './plans/[planId]',
  },
  {
    path: '/research',
    name: 'research',
    icon: 'radarChart',
    component: './research',
  },
  {
    path: '/selection',
    name: 'selection',
    icon: 'filter',
    component: './selection',
  },
  {
    path: '/content',
    name: 'content',
    icon: 'appstore',
    component: './content',
  },
  {
    path: '/content/:id',
    name: 'content-item',
    hideInMenu: true,
    component: './content/workspace',
  },
  { path: '/review', name: 'review', icon: 'audit', component: './review' },
  {
    path: '/review/:taskId',
    name: 'review-task',
    hideInMenu: true,
    component: './review/[taskId]',
  },
  {
    path: '/calendar',
    name: 'calendar',
    icon: 'calendar',
    component: './calendar',
  },
  {
    path: '/analytics',
    name: 'analytics',
    icon: 'lineChart',
    routes: [
      { path: '/analytics', redirect: '/analytics/posts' },
      {
        path: '/analytics/posts',
        name: 'posts',
        component: './analytics/posts',
      },
      {
        path: '/analytics/posts/:publicationId',
        name: 'post',
        hideInMenu: true,
        component: './analytics/posts/[publicationId]',
      },
      {
        path: '/analytics/account',
        name: 'account',
        component: './analytics/account',
      },
    ],
  },
  { path: '/reports', name: 'reports', icon: 'fileText', component: './reports' },
  {
    path: '/reports/:id',
    name: 'report',
    hideInMenu: true,
    component: './reports/[id]',
  },
  {
    path: '/library',
    name: 'library',
    icon: 'picture',
    component: './library',
  },
  {
    path: '/settings',
    name: 'settings',
    icon: 'setting',
    routes: [
      { path: '/settings', redirect: '/settings/accounts' },
      {
        path: '/settings/accounts',
        name: 'accounts',
        component: './settings/accounts',
      },
      {
        path: '/settings/accounts/:id',
        name: 'account',
        hideInMenu: true,
        component: './settings/accounts/[id]',
      },
      {
        path: '/settings/system',
        name: 'system',
        access: 'canAdmin',
        component: './settings/system',
      },
    ],
  },
  {
    path: '/exception/403',
    name: 'forbidden',
    hideInMenu: true,
    component: './exception/403',
  },
  {
    path: '/exception/500',
    name: 'server-error',
    hideInMenu: true,
    component: './exception/500',
  },
  { path: '/*', name: 'not-found', hideInMenu: true, component: './exception/404' },
];
