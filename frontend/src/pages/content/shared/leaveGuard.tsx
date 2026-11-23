import { history } from '@umijs/max';
import { Modal } from 'antd';
import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/**
 * Unsaved-changes guard for the workspace tabs. A tab registers its dirty state with
 * `useLeaveGuard`; the shell asks `confirmLeave()` before switching tabs, the router is blocked
 * for other navigation, and the browser asks before closing the window.
 */
type GuardEntry = { dirty: boolean; message: string };

type GuardRegistry = {
  register: (id: symbol, entry: GuardEntry) => void;
  unregister: (id: symbol) => void;
  pending: () => GuardEntry | undefined;
};

const LeaveGuardContext = createContext<GuardRegistry | null>(null);

export function confirmDiscard(message: string, okText = 'Leave without saving'): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: message,
      okText,
      okButtonProps: { danger: true },
      cancelText: 'Keep editing',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export const LeaveGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const entries = useRef(new Map<symbol, GuardEntry>());
  const registry = useRef<GuardRegistry>({
    register: (id, entry) => entries.current.set(id, entry),
    unregister: (id) => entries.current.delete(id),
    pending: () => Array.from(entries.current.values()).find((e) => e.dirty),
  });
  return (
    <LeaveGuardContext.Provider value={registry.current}>{children}</LeaveGuardContext.Provider>
  );
};

/** Resolves true when there is nothing unsaved, or the user agrees to discard it. */
export function useConfirmLeave() {
  const registry = useContext(LeaveGuardContext);
  return useCallback(async () => {
    const entry = registry?.pending();
    if (!entry) return true;
    return confirmDiscard(entry.message);
  }, [registry]);
}

export function useLeaveGuard(
  dirty: boolean,
  message = 'You have unsaved changes. Leave without saving?',
) {
  const registry = useContext(LeaveGuardContext);
  const id = useRef(Symbol('leave-guard'));

  useEffect(() => {
    const key = id.current;
    registry?.register(key, { dirty, message });
    return () => registry?.unregister(key);
  }, [registry, dirty, message]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    // `history.block` exists on the history v5 object Umi uses; guard in case it is absent.
    const block = (history as unknown as { block?: (fn: (tx: any) => void) => () => void })
      .block;
    let unblock: (() => void) | undefined;
    if (typeof block === 'function') {
      unblock = block.call(history, (tx: { retry: () => void; location: { pathname: string } }) => {
        // Changing only the query string (tab switches) is handled by the shell.
        if (tx.location.pathname === window.location.pathname) {
          unblock?.();
          tx.retry();
          return;
        }
        confirmDiscard(message).then((ok) => {
          if (ok) {
            unblock?.();
            tx.retry();
          }
        });
      });
    }
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      unblock?.();
    };
  }, [dirty, message]);
}
