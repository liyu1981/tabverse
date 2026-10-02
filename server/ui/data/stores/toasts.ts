/**
 * Transient messages: what just worked, and what just did not.
 *
 * A store rather than Blueprint's global `Toaster` singleton, for two reasons
 * worth keeping: a test can assert what was said without a DOM, and the
 * operator's destructive actions (revoke, archive, delete) all report through
 * the same channel, so "did the server refuse?" is one visible thing.
 */

import { createEvent, createStore } from 'effector';

export type ToastKind = 'info' | 'good' | 'bad';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export const pushToast = createEvent<{ message: string; kind?: ToastKind }>();
export const dismissToast = createEvent<number>();

let nextId = 1;

export const $toasts = createStore<Toast[]>([])
  .on(pushToast, (toasts, { message, kind }) => [
    ...toasts,
    { id: nextId++, message, kind: kind || 'info' },
  ])
  .on(dismissToast, (toasts, id) => toasts.filter((t) => t.id !== id));

/**
 * The server's own sentence, or a prefix saying which call failed. A 409 is a
 * precondition the server explains ("revoke it first", "last active 2d ago,
 * needs 30 days") and that is exactly what the operator needs to read, so it is
 * shown as it is rather than flattened into "operation failed".
 */
export function reportFailure(what: string, error: unknown): void {
  const status = (error as { status?: number })?.status;
  const message = (error as Error)?.message || 'unknown error';
  pushToast({
    message: status === 409 ? message : `${what} failed: ${message}`,
    kind: 'bad',
  });
}

export function reportSuccess(message: string): void {
  pushToast({ message, kind: 'good' });
}
