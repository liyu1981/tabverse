/**
 * Suspending inactive tabs.
 *
 * The decision is a pure function of what Chrome already says about each tab,
 * so the interesting rules are testable with no browser (the shape
 * `previewReaper.ts` uses for the same reason):
 *
 *  - `Tab.lastAccessed` (Chrome 121+, and the floor is 140) is the clock. It is
 *    better than a map we keep ourselves: it survives a worker teardown and it
 *    reflects real activity, not our guess at it.
 *  - An unknown clock is not evidence of inactivity, so a tab without a
 *    `lastAccessed` is left alone.
 *  - A tab is only ever a candidate in a window that holds a Tabverse manager
 *    tab. This keeps the extension inside its remit - it suspends the tabs of a
 *    tabverse, not a stranger's tabs in an unrelated window.
 *
 * The sweep never throws. A `discard` that fails because the tab went away, or
 * because Chrome refuses half of a split view, is logged and the pass goes on.
 */
import { isTabSpaceManagerPage, logger } from '../../global';
import {
  DEFAULT_SUSPEND_AFTER_MINUTES,
  clampSuspendMinutes,
  loadSuspendSettings,
} from './suspendSettings';
import { readWhitelistedChromeTabIds } from './suspendWhitelist';

export interface SuspendCandidate {
  chromeTabId: number;
  /** `chrome.tabs.Tab.lastAccessed`, in ms since the epoch. */
  lastAccessed: number | undefined;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  /** `undefined` before Chrome 121, and on tabs Chrome will not discard. */
  autoDiscardable: boolean | undefined;
  isManagerTab: boolean;
  whitelisted: boolean;
}

/**
 * Which of these tabs to discard, now, with `afterMs` the inactivity window.
 *
 * Every rule is a skip, and they are all required: the tab has to be a plain,
 * quiet, unprotected, non-active tab that has been left alone long enough.
 */
export function tabsToSuspend(
  candidates: SuspendCandidate[],
  now: number,
  afterMs: number,
): number[] {
  return candidates
    .filter(
      (candidate) =>
        !candidate.active &&
        !candidate.pinned &&
        !candidate.audible &&
        !candidate.discarded &&
        candidate.autoDiscardable !== false &&
        !candidate.isManagerTab &&
        !candidate.whitelisted &&
        typeof candidate.lastAccessed === 'number' &&
        now - candidate.lastAccessed >= afterMs,
    )
    .map((candidate) => candidate.chromeTabId);
}

export interface SuspendReport {
  /** False when the switch is off; nothing else is then meaningful. */
  enabled: boolean;
  /** Tabs considered, i.e. in a window that holds a tabverse. */
  scanned: number;
  /** Tabverse windows seen. */
  windows: number;
  suspended: number;
  failed: number;
}

export interface SuspendOptions {
  /** Injected clock; production uses `Date.now()`. */
  now?: number;
  /** Injected settings; production reads them from storage. */
  settings?: { enabled: boolean; afterMinutes: number };
  /** Injected whitelist; production reads the published session set. */
  whitelistedChromeTabIds?: Set<number>;
  /** Injected tab list; production is one `chrome.tabs.query({})`. */
  queryTabs?: () => Promise<chrome.tabs.Tab[]>;
  /** Injected discard; production is `chrome.tabs.discard`. */
  discard?: (chromeTabId: number) => Promise<unknown>;
}

async function resolveSettings(
  options: SuspendOptions,
): Promise<{ enabled: boolean; afterMinutes: number }> {
  if (options.settings) {
    return options.settings;
  }
  const loaded = await loadSuspendSettings();
  return {
    enabled: loaded.enabled === true,
    afterMinutes: loaded.afterMinutes ?? DEFAULT_SUSPEND_AFTER_MINUTES,
  };
}

/**
 * One sweep. Returns what it did; see `SuspendReport`.
 */
export async function suspendInactiveTabs(
  options: SuspendOptions = {},
): Promise<SuspendReport> {
  const report: SuspendReport = {
    enabled: false,
    scanned: 0,
    windows: 0,
    suspended: 0,
    failed: 0,
  };

  const settings = await resolveSettings(options);
  if (!settings.enabled) {
    return report;
  }
  report.enabled = true;

  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await (options.queryTabs ?? (() => chrome.tabs.query({})))();
  } catch (err) {
    logger.log('could not list tabs for suspension', err);
    return report;
  }

  // The windows that hold a tabverse. A manager tab is how a window says so,
  // and its own tab is never a candidate (it is pinned anyway).
  const tabverseWindowIds = new Set<number>();
  for (const tab of tabs) {
    if (isTabSpaceManagerPage(tab) && typeof tab.windowId === 'number') {
      tabverseWindowIds.add(tab.windowId);
    }
  }
  report.windows = tabverseWindowIds.size;

  const whitelisted =
    options.whitelistedChromeTabIds ?? (await readWhitelistedChromeTabIds());

  const candidates: SuspendCandidate[] = [];
  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || !tabverseWindowIds.has(tab.windowId)) {
      continue;
    }
    report.scanned += 1;
    candidates.push({
      chromeTabId: tab.id,
      lastAccessed: tab.lastAccessed,
      active: tab.active === true,
      pinned: tab.pinned === true,
      audible: tab.audible === true,
      discarded: tab.discarded === true,
      autoDiscardable: tab.autoDiscardable,
      isManagerTab: isTabSpaceManagerPage(tab),
      whitelisted: whitelisted.has(tab.id),
    });
  }

  const now = options.now ?? Date.now();
  const afterMs = clampSuspendMinutes(settings.afterMinutes) * 60_000;
  const doomed = tabsToSuspend(candidates, now, afterMs);

  const discard =
    options.discard ??
    ((chromeTabId: number) => chrome.tabs.discard(chromeTabId));
  for (const chromeTabId of doomed) {
    try {
      await discard(chromeTabId);
      report.suspended += 1;
    } catch (err) {
      report.failed += 1;
      logger.log('could not suspend tab', chromeTabId, err);
    }
  }
  return report;
}

/** One log line for a sweep that did something, or '' when there is nothing. */
export function describeSuspension(report: SuspendReport): string {
  if (!report.enabled || (report.suspended === 0 && report.failed === 0)) {
    return '';
  }
  const failed = report.failed > 0 ? `, ${report.failed} failed` : '';
  return `suspended ${report.suspended} inactive tab(s) across ${report.windows} tabverse window(s)${failed}`;
}
