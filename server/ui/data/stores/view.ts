/**
 * Which of the console's two pages is on screen: the account console at
 * `/console`, or the operator's admin page at `/console/admin` (adr/0024).
 *
 * A store rather than the path alone, because switching between them is an
 * in-app navigation: the header button changes it and `history.pushState` keeps
 * the URL in step, so a reload or a bookmark still lands in the right place
 * (boot reads the path once). The admin page has its own sections (accounts,
 * registration invites) as a second, page-local rail.
 */
import { createEvent, createStore } from 'effector';

export type ConsoleView = 'console' | 'admin';

export const setView = createEvent<ConsoleView>();

export const $view = createStore<ConsoleView>('console').on(
  setView,
  (_, view) => view,
);
