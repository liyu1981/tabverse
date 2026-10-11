/**
 * Keeps the worker's suspension whitelist in step with the live tabverse.
 *
 * Page-only, and deliberately separate from `suspendWhitelist.ts`: that module
 * is imported by the service worker's sweep, and if it imported the tabverse
 * store the worker bundle would drag the whole store (and Dexie with it) in for
 * a feature that only ever needs a `chrome.storage` read.
 *
 * Every tab event (a tab opened, closed, or restored into another window) and
 * every whitelist toggle republishes the resolved set, so a closed tab's
 * `chromeTabId` is removed before it can be recycled onto a new, unwhitelisted
 * tab. Started from `tabSpaceBootstrap`.
 */
import { $tabSpace } from './store';
import {
  getWhitelistedTabIds,
  loadWhitelist,
  publishWhitelistForTabSpace,
  resolveWhitelistedChromeTabIds,
  subscribeWhitelist,
} from './suspendWhitelist';

export function startMonitorSuspendWhitelist(): void {
  void loadWhitelist().then(() => publishCurrentWhitelist());
  $tabSpace.watch(() => publishCurrentWhitelist());
  subscribeWhitelist(() => publishCurrentWhitelist());
}

function publishCurrentWhitelist(): void {
  const tabSpace = $tabSpace.getState();
  const ids = resolveWhitelistedChromeTabIds(
    getWhitelistedTabIds(tabSpace.id),
    tabSpace.tabs.toArray(),
  );
  void publishWhitelistForTabSpace(tabSpace.id, ids);
}
