import React, { useState } from 'react';

import { LoadStatus } from '../../global';
import { t } from '../../i18n';
import { useAsyncEffect } from './useAsyncEffect';

/**
 * A tool's loading gate: run its loader, then draw it.
 *
 * This used to be a *factory* - `getLoadingComponent2(SomeView, someLoader)`
 * built a component inside a function. That works, but React sees a brand new
 * component type every time the factory runs, so everything below it is thrown
 * away and rebuilt (all of a tool's state, every editor, every list) even when
 * nothing about the tool changed. It is one module-level component now, and the
 * view and its loader are props:
 *
 *   <LoadingGate loader={loadTodos}>
 *     <TodoView />
 *   </LoadingGate>
 *
 * The child element is only *created* until the loader settles; it is not
 * rendered (or mounted) before then, so the view never draws a half-loaded
 * list. `loader` is a dependency of the effect: the callers build it per
 * tabverse (`TabSpaceRightSideView`), so switching tabverses reloads the tool
 * without remounting the gate around it.
 */
export interface ILoadingGateProps {
  children: React.ReactNode;
  loader: () => Promise<void>;
}

export function LoadingGate(props: ILoadingGateProps) {
  const { children, loader } = props;
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(LoadStatus.Loading);

  useAsyncEffect(async () => {
    setLoadStatus(LoadStatus.Loading);
    await loader();
    setLoadStatus(LoadStatus.Done);
  }, [loader]);

  return loadStatus === LoadStatus.Done ? (
    <div>{children}</div>
  ) : (
    <div>{t('commonLoading')}</div>
  );
}
