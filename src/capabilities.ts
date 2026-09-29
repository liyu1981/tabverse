/**
 * Optional Chrome features, and whether this browser has them.
 *
 * The rule the whole feature set is built on: **tab capture is the baseline.**
 * `scanCurrentTabs` only reads fields that have existed since Chrome 1 (id,
 * url, title, favIconUrl, pinned, index, windowId), so the extension keeps
 * working on any Chrome that can run an MV3 extension. Everything below is an
 * *enrichment*: each one is detected, guarded, and fails soft, and when it is
 * missing the UI says so in one line instead of pretending.
 *
 * Detection is by feature test, not by version sniffing: the API surface is the
 * honest signal, and a backport or a flag would otherwise be invisible.
 *
 * Verified against the Chromium API schemas on 2026-09-28:
 *   Tab.groupId            88+   (no permission)
 *   chrome.tabGroups       89+   (needs the "tabGroups" permission)
 *   Tab.splitViewId       140+   (no permission, tabs.SPLIT_VIEW_ID_NONE)
 *   tabs.createSplit      155+   (write path for split views)
 */

export type CapabilityId = 'tabGroups' | 'splitViewRead' | 'splitViewWrite';

export interface Capability {
  id: CapabilityId;
  /** Shown in the warning banner, and in the list it expands into. */
  title: string;
  /** Chrome version that introduced it, quoted in the message. */
  requiresChrome: number;
  detect: () => boolean;
  /** One short line: what the user does not get without it. */
  lost: string;
}

const hasChrome = () => typeof chrome !== 'undefined' && !!chrome;

const detectTabGroups = () =>
  hasChrome() && typeof chrome.tabGroups?.query === 'function';

// SPLIT_VIEW_ID_NONE only exists from 140 on, which makes it a better probe
// than reading Tab.splitViewId (we would need a live tab to see that).
const detectSplitViewRead = () =>
  hasChrome() && typeof chrome.tabs?.SPLIT_VIEW_ID_NONE === 'number';

const detectSplitViewWrite = () =>
  hasChrome() &&
  typeof (chrome.tabs as any)?.createSplit === 'function' &&
  typeof (chrome.tabs as any)?.unsplit === 'function';

export const CAPABILITIES: Capability[] = [
  {
    id: 'tabGroups',
    title: 'Tab groups',
    requiresChrome: 89,
    detect: detectTabGroups,
    lost: 'Tabs list ungrouped, and restores come back ungrouped.',
  },
  {
    id: 'splitViewRead',
    title: 'Showing split views',
    requiresChrome: 140,
    detect: detectSplitViewRead,
    lost: 'Side-by-side tabs are listed as two separate tabs.',
  },
  {
    id: 'splitViewWrite',
    title: 'Creating split views',
    requiresChrome: 155,
    detect: detectSplitViewWrite,
    lost: 'Tabverse cannot open two tabs side by side.',
  },
];

/** Major version of the running browser, for the banner text. 0 if unknown. */
export function detectChromeMajorVersion(): number {
  if (typeof navigator === 'undefined') {
    return 0;
  }
  const match = /Chrome\/(\d+)/.exec(navigator.userAgent ?? '');
  return match ? parseInt(match[1], 10) : 0;
}

let cache: Capability[] | undefined;

/**
 * The capabilities this browser does not have. Cached: the answer cannot change
 * without a reload, and the tab list re-renders on every tab event.
 */
export function missingCapabilities(): Capability[] {
  if (!cache) {
    cache = CAPABILITIES.filter((capability) => !capability.detect());
  }
  return cache;
}

export function hasCapability(id: CapabilityId): boolean {
  return CAPABILITIES.find((c) => c.id === id)?.detect() ?? false;
}

/** Test hook: the detection cache is module state. */
export function resetCapabilitiesCacheForTest(): void {
  cache = undefined;
}
