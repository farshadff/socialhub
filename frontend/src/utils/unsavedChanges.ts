import { history } from '@umijs/max';
import { Modal } from 'antd';
import { useEffect } from 'react';

export const DISCARD_TITLE = 'Discard unsaved changes?';

/**
 * Asks "Discard unsaved changes?" before leaving while `dirty` is true: any in-app navigation
 * (sidebar, links, a `?tab=` change, the account switcher) goes through the history blocker, and
 * the browser asks on reload or close (history's `beforeunload` handling).
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return undefined;
    let open = false;
    const unblock = history.block((transition) => {
      if (open) return;
      open = true;
      Modal.confirm({
        title: DISCARD_TITLE,
        content: 'Your changes have not been saved.',
        okText: 'Discard changes',
        okButtonProps: { danger: true },
        cancelText: 'Keep editing',
        onOk: () => {
          unblock();
          transition.retry();
        },
        afterClose: () => {
          open = false;
        },
      });
    });
    return unblock;
  }, [dirty]);
}
