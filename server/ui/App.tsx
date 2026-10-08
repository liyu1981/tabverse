import React, { useEffect } from 'react';
import { useUnit } from 'effector-react';

import { boot } from './data/actions';
import { $bootStatus } from './data/stores/session';
import { AssumeBar } from './components/AssumeBar';
import { OperatorHint, TopBar } from './components/TopBar';
import { Toasts } from './components/Toasts';
import { AccountView } from './views/AccountView';
import { LoadingView, SignInView } from './views/SignInView';
import { PairView } from './views/PairView';
import { TabverseDrawer } from './views/tabverse/TabverseDrawer';
import { readPairFromUrl, takeStashedPairRequest } from './data/pair';

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
  // The extension opened this page at `/console/pair?ext=…&nonce=…` (adr/0020,
  // adr/0024). The request is read from the URL, or from the stash a sign-in
  // round trip left behind, and while one is pending this is the pair view -
  // even signed out, because that is the page the person was sent here to use.
  const [pairRequest, setPairRequest] = React.useState(
    () => readPairFromUrl() ?? takeStashedPairRequest(),
  );

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    // Back and forward move the query, and a pair request that appears that way
    // has to be picked up the way the one in the address bar was.
    const onPop = () => {
      const request = readPairFromUrl();
      if (request) setPairRequest(request);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The pair view waits for the session the way every other view does: until
  // /console/me has answered there is no way to know whether this person has to
  // sign in first, and a "sign in to continue" banner over a form that is about
  // to be replaced is the one thing worth avoiding.
  const showPair = pairRequest !== null && status !== 'loading';

  return (
    <>
      <TopBar />
      <OperatorHint />
      <AssumeBar />
      {showPair ? <PairView request={pairRequest} /> : null}
      {!showPair && status === 'signed-in' ? <AccountView /> : null}
      {!showPair && status === 'signed-out' ? <SignInView /> : null}
      {status === 'loading' ? <LoadingView /> : null}
      {/* The drawer is outside the account view on purpose: it belongs to the
          console, not to a tab, and it survives the tab it was opened from. */}
      {!showPair && status === 'signed-in' ? <TabverseDrawer /> : null}
      <Toasts />
    </>
  );
}
