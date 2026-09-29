import React, { useContext, useEffect } from 'react';

import { OverlayToaster, Toaster } from '@blueprintjs/core';

export interface IManagerViewContext {
  toaster: Toaster;
}

/**
 * OverlayToaster.create() is async in Blueprint 6, so context consumers get a
 * silent fallback until the real one is mounted (toasts fired during the very
 * first paint are dropped rather than crashing the app).
 */
const silentToaster = {
  show: () => '',
  dismiss: () => undefined,
  dismissAll: () => undefined,
  getToasts: () => [],
} as unknown as Toaster;

export const ManagerViewContext = React.createContext<IManagerViewContext>({
  toaster: silentToaster,
});

export function ManagerViewContextSupport() {
  const managerViewContext = useContext(ManagerViewContext);
  useEffect(() => {
    let cancelled = false;
    OverlayToaster.create().then((toaster) => {
      if (!cancelled) {
        managerViewContext.toaster = toaster;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [managerViewContext]);
  return null;
}
