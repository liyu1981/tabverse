import React, { useEffect } from 'react';
import { useUnit } from 'effector-react';

import { $toasts, dismissToast } from '../data/stores/toasts';
import classes from './Toasts.module.scss';

const TOAST_MS = 4000;

/**
 * The console's one channel for "that worked" and "that did not".
 *
 * A list of its own rather than Blueprint's static `Toaster` singleton: the
 * operator's destructive actions all report here, so a refusal from the server
 * is one visible thing, and a test can read what was said without a DOM.
 */
export function Toasts() {
  const toasts = useUnit($toasts);

  return (
    <div className={classes.stack} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          message={toast.message}
          kind={toast.kind}
        />
      ))}
    </div>
  );
}

function Toast(props: { id: number; message: string; kind: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(props.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [props.id]);

  return (
    <button
      type="button"
      className={`${classes.toast} ${
        props.kind === 'bad'
          ? classes.bad
          : props.kind === 'good'
            ? classes.good
            : ''
      }`}
      onClick={() => dismissToast(props.id)}
    >
      {props.message}
    </button>
  );
}
