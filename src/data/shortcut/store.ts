import { createApi, createStore } from 'effector';

import { exposeDebugData } from '../../debug';
import { Shortcut, removeShortcut, upsertShortcut } from './Shortcut';

/**
 * The Launchpad's shortcuts, in the page.
 *
 * One flat list, unlike the per-tabverse tools: a shortcut has no tabverse and
 * no aggregate ordering row, so the list is whatever the table holds. It is
 * loaded at bootstrap (`loadShortcuts`) and re-read when the table changes in
 * another context (`startMonitorShortcutChanges`), so the tab/bookmark/history
 * buttons can show their saved state without a read per row.
 */
export const $shortcuts = createStore<Shortcut[]>([]);

const shortcutApi = createApi($shortcuts, {
  update: (_last, shortcuts: Shortcut[]) => shortcuts,
  upsert: (last, shortcut: Shortcut) => upsertShortcut(last, shortcut),
  remove: (last, id: string) => removeShortcut(last, id),
});

export const shortcutStoreApi = shortcutApi;

exposeDebugData('shortcut', { $shortcuts, shortcutStoreApi });
