/**
 * The manager page's side of the dedup protocol (adr/0033).
 *
 * Every call here is a message to the worker; the page never reads tabs and
 * never closes one. The answer (or a pushed `ReportChanged`) lands in
 * `$dedupReport`, which the notice draws.
 */
import { DedupMsg, sendChromeMessage } from '../../message/message';
import type { DedupReport } from './dedup';
import { dedupStoreApi } from './dedupStore';

function asReport(value: unknown): DedupReport | null {
  return value && typeof value === 'object' ? (value as DedupReport) : null;
}

/** Ask the worker for the current report (the "returned to the extension" call). */
export async function requestDedupReport(): Promise<DedupReport | null> {
  const report = asReport(
    await sendChromeMessage({
      type: DedupMsg.RequestReport,
      payload: undefined,
    }),
  );
  dedupStoreApi.set(report);
  return report;
}

/** Close the reviewed duplicates. */
export async function applyDedupReport(fingerprint: string): Promise<void> {
  const report = asReport(
    await sendChromeMessage({ type: DedupMsg.Apply, payload: fingerprint }),
  );
  dedupStoreApi.set(report);
}

/** Stop asking about this exact set. */
export async function ignoreDedupReport(fingerprint: string): Promise<void> {
  const report = asReport(
    await sendChromeMessage({ type: DedupMsg.Ignore, payload: fingerprint }),
  );
  dedupStoreApi.set(report);
}

/** Never offer this URL again. */
export async function alwaysIgnoreDedupUrl(key: string): Promise<void> {
  const report = asReport(
    await sendChromeMessage({ type: DedupMsg.AlwaysIgnore, payload: key }),
  );
  dedupStoreApi.set(report);
}

/** Put back what the last apply closed. */
export async function undoDedupReport(): Promise<void> {
  const report = asReport(
    await sendChromeMessage({ type: DedupMsg.Undo, payload: undefined }),
  );
  dedupStoreApi.set(report);
}

/** The worker's push; the message handler calls this. */
export function receiveDedupReport(value: unknown): void {
  dedupStoreApi.set(asReport(value));
}
