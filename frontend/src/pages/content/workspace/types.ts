import type { ContentItemDetail, ItemStatus } from '@/services/socialhub/content';

export type TabKey =
  | 'brief'
  | 'script'
  | 'production'
  | 'checks'
  | 'publishing'
  | 'performance'
  | 'history';

export const TAB_KEYS: TabKey[] = [
  'brief',
  'script',
  'production',
  'checks',
  'publishing',
  'performance',
  'history',
];

/** The contract between the workspace shell (E03-S04) and every tab. */
export type WorkspaceTabProps = {
  item: ContentItemDetail;
  /** Refetches the item; tabs call it after every successful action. */
  reload: () => unknown;
  /** Switches the workspace to another tab (for example after submitting). */
  switchTab: (tab: TabKey) => void;
  /** Opens the "Format and role" modal of the header (E04-S02). */
  openFormatModal: () => void;
};

/** E03-S04: the tab shown when `?tab=` is absent. */
export function defaultTabFor(status: ItemStatus): TabKey {
  switch (status) {
    case 'selected':
      return 'brief';
    case 'briefed':
      return 'script';
    case 'scripted':
    case 'in_production':
    case 'needs_revision':
      return 'production';
    case 'in_check':
    case 'in_review':
      return 'checks';
    case 'approved':
    case 'scheduled':
    case 'publishing':
    case 'failed':
      return 'publishing';
    case 'published':
      return 'performance';
    case 'cancelled':
      return 'history';
    default:
      return 'brief';
  }
}

/** Statuses after which brief, script and production are read-only. */
export const LOCKED_AFTER_PRODUCTION: ItemStatus[] = [
  'in_check',
  'in_review',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
];
