import React, { useEffect } from 'react';
import { useUnit } from 'effector-react';

import { boot } from './data/actions';
import { $bootStatus } from './data/stores/session';
import { AssumeBar } from './components/AssumeBar';
import { OperatorHint, TopBar } from './components/TopBar';
import { Toasts } from './components/Toasts';
import { AccountView } from './views/AccountView';
import { LoadingView, SignInView } from './views/SignInView';
import { TabverseDrawer } from './views/tabverse/TabverseDrawer';

/**
 * The whole console: a frame that never changes (the brand bar, the read-only
 * bar, the toasts) and one of two things under it - the sign-in form or the
 * account view, which is itself four tabs (adr/0014).
 *
 * Boot runs once, at mount: ask who we are, then land on whatever the URL names
 * or on the account the session belongs to.
 */
export function App() {
  const status = useUnit($bootStatus);

  useEffect(() => {
    void boot();
  }, []);

  return (
    <>
      <TopBar />
      <OperatorHint />
      <AssumeBar />
      {status === 'signed-in' ? <AccountView /> : null}
      {status === 'signed-out' ? <SignInView /> : null}
      {status === 'loading' ? <LoadingView /> : null}
      {/* The drawer is outside the account view on purpose: it belongs to the
          console, not to a tab, and it survives the tab it was opened from. */}
      {status === 'signed-in' ? <TabverseDrawer /> : null}
      <Toasts />
    </>
  );
}
