import { Button } from '@blueprintjs/core';
import React, { useEffect, useState } from 'react';
import { useUnit } from 'effector-react';

import { refreshImpersonation, stopImpersonation } from '../data/actions';
import { $isAssumed, $impersonation } from '../data/stores/session';
import classes from '../layout.module.scss';

/**
 * The read-only bar, with the time left in it.
 *
 * The countdown is drawn from the server's `until` and ticked here rather than
 * re-asked for, so the number moves without a request every second; the state
 * behind it is re-read from `/console/impersonation` on a slower beat, because
 * that endpoint is the only thing that knows whether the window is still open.
 */
export function AssumeBar() {
  const { assuming, info } = useUnit({
    assuming: $isAssumed,
    info: $impersonation,
  });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!assuming) {
      return undefined;
    }
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    // The server is the truth about the window; once a minute is often enough
    // to notice it closed (by another tab, or by the operator in another one).
    const poll = window.setInterval(() => void refreshImpersonation(), 60000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [assuming]);

  if (!assuming || !info) return null;

  const until = info.until ? Date.parse(info.until) : 0;
  const left = until ? Math.max(0, Math.round((until - now) / 1000)) : 0;

  return (
    <div className={classes.assumeBar}>
      <span className={classes.assumeDot} aria-hidden={true} />
      <span>
        Read only — you are looking at {info.as || info.user_id} as they see it
        {info.as_operator ? ', as an operator' : ''}
        {left ? ` · ${Math.floor(left / 60)}m ${left % 60}s left` : ''}
      </span>
      <Button
        small={true}
        minimal={true}
        onClick={() => void stopImpersonation()}
      >
        Stop looking
      </Button>
    </div>
  );
}
