import { AnchorButton } from '@blueprintjs/core';
import React, { useEffect } from 'react';
import { useUnit } from 'effector-react';

import { boot } from './data/actions';
import { $bootStatus, $me } from './data/stores/session';
import { $view } from './data/stores/view';
import { AssumeBar } from './components/AssumeBar';
import { OperatorHint, TopBar } from './components/TopBar';
import { Toasts } from './components/Toasts';
import { AccountView } from './views/AccountView';
import { AdminView } from './views/AdminView';
import { LoadingView, SignInView } from './views/SignInView';
import { RegisterView } from './views/RegisterView';
import { PairView } from './views/PairView';
import { TabverseDrawer } from './views/tabverse/TabverseDrawer';
import { readPairFromUrl, takeStashedPairRequest } from './data/pair';
import classes from './layout.module.scss';

/**
 * The whole console: a frame that never changes (the brand bar, the read-only
 * bar, the toasts) and one of two things under it - the sign-in form or the
 * signed-in console, which is either the account view at /console or the
 * operator's page at /console/admin (`stores/view.ts`).
 *
 * Boot runs once, at mount: ask who we are, then land on whatever the URL names
 * or on the account the session belongs to.
 */
export function App() {
  const { status, me, view } = useUnit({
    status: $bootStatus,
    me: $me,
    view: $view,
  });
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
  // The operator's page is its own view; a person who lands on it gets a
  // sentence and a way back rather than a page they cannot use.
  const onAdmin = view === 'admin';
  const isOperator = me?.role === 'admin';
  // A pending registration can sign in, but has no account to look at yet: the
  // one thing to show is the notice.
  const pending = me?.pending_registration === true;
  const signedIn = status === 'signed-in' && !pending;

  return (
    <>
      {/* The frame that never changes, as one sticky unit: the brand bar, the
          operator hint and the read-only bar. Keeping them in one stacking
          context is what keeps them from overlapping each other on scroll, and
          putting the unit below the overlay layer is what keeps the notice from
          painting over the tabverse drawer (whose overlay is z-index 20). */}
      <div className={classes.header}>
        <TopBar />
        <OperatorHint />
        <AssumeBar />
      </div>
      {showPair ? <PairView request={pairRequest} /> : null}
      {!showPair && status === 'signed-in' && pending ? (
        <PendingRegistrationView />
      ) : null}
      {!showPair && signedIn && onAdmin && isOperator ? <AdminView /> : null}
      {!showPair && signedIn && onAdmin && !isOperator ? (
        <OperatorOnlyView />
      ) : null}
      {!showPair && signedIn && !onAdmin ? <AccountView /> : null}
      {!showPair && status === 'signed-out' ? <SignInView /> : null}
      {!showPair && status === 'needs-registration' ? <RegisterView /> : null}
      {status === 'loading' ? <LoadingView /> : null}
      {/* The drawer is outside the account view on purpose: it belongs to the
          console, not to a tab, and it survives the tab it was opened from. */}
      {!showPair && signedIn && !onAdmin ? <TabverseDrawer /> : null}
      <Toasts />
    </>
  );
}

/** A person whose registration is waiting for an operator's invitation. */
function PendingRegistrationView() {
  return (
    <main className={classes.content}>
      <div className={classes.viewHead}>
        <div>
          <h1>Registration request received</h1>
          <p className="muted small">
            Your request is with this server's operators. When it is approved
            you will get an invitation email, and then this account works - sign
            in again to use it. Nothing else is needed from you.
          </p>
        </div>
      </div>
    </main>
  );
}

/** A person on the operator's page. */
function OperatorOnlyView() {
  return (
    <main className={classes.content}>
      <div className={classes.viewHead}>
        <div>
          <h1>Operators only</h1>
          <p className="muted small">
            This page is for the server's operators. Your own account is at the
            console.
          </p>
        </div>
        <div className={classes.viewActions}>
          <AnchorButton minimal={true} small={true} href="/console">
            Console
          </AnchorButton>
        </div>
      </div>
    </main>
  );
}
