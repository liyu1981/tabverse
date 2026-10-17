/**
 * The duplicate report the manager page draws (adr/0033).
 *
 * A tiny effector store: the worker pushes a report with a message and the
 * notice reads it. Keeping the report out of the page's own state is what makes
 * the advisor cheap - the page never lists tabs or compares URLs.
 */
import { createApi, createStore } from 'effector';

import type { DedupReport } from './dedup';

export const $dedupReport = createStore<DedupReport | null>(null);

export const dedupStoreApi = createApi($dedupReport, {
  set: (_previous, report: DedupReport | null) => report,
});
