/**
 * The duplicate advisor's worker half (adr/0033): scan, store, apply, undo.
 *
 * This is the only file in the feature that touches `chrome.*`, in the mould of
 * `suspender.ts` and `previewReaper.ts`: a scan reads tabs, calls the pure
 * `findDuplicateGroups`, and stores a report; an apply re-validates against the
 * live tabs and closes only what is still safe. Nothing here runs on the
 * manager page's render path, and no event handler waits on a scan - tab events
 * only schedule one.
 *
 * The report lives in `chrome.storage.session`: it names `chromeTabId`s, which
 * are scoped to a browser run and recycled, so it must not outlive one. The
 * ignore list and the dismissed fingerprints are device settings, so they live
 * in `chrome.storage.local`.
 */
import { isTabSpaceManagerPage, logger } from '../../global';
import {
  ChromeStorageArea,
  MemoryStorageArea,
  type StorageAreaLike,
} from '../repo/outbox';
import { DedupMsg, sendChromeMessage } from '../../message/message';
import {
  type DedupReport,
  type DedupTab,
  describeDedup,
  findDuplicateGroups,
  planDedupApply,
  reportFingerprint,
} from './dedup';
import {
  DEFAULT_DEDUP_SCAN_MINUTES,
  DEDUP_ENABLED_KEY,
  DEDUP_SCAN_MINUTES_KEY,
  getDedupSettings,
  loadDedupSettings,
} from './dedupSettings';

const REPORT_KEY = 'tabverse_dedup_report_v1';
const UNDO_KEY = 'tabverse_dedup_undo_v1';
const IGNORE_KEY = 'tabverse_dedup_ignore_v1';
const DISMISSED_KEY = 'tabverse_dedup_dismissed_v1';

const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UNDO_TABS = 100;
const DEDUP_ALARM = 'tabverse_dedup_scan';
const SCAN_DEBOUNCE_MS = 2000;

/** One tab the last apply closed, enough to put it back. */
interface UndoableTab {
  url: string;
  index: number;
  windowId: number;
  pinned: boolean;
}

interface UndoRecord {
  at: number;
  tabs: UndoableTab[];
}

/** The chrome surface this module needs; injected by the tests. */
export interface DedupTabsApi {
  query(): Promise<chrome.tabs.Tab[]>;
  close(ids: number[]): Promise<void>;
  open(tab: UndoableTab): Promise<void>;
}

export interface DedupScanOptions {
  now?: number;
  tabs?: DedupTabsApi;
  /** Overrides the stored switch; the tests use it to skip settings. */
  enabled?: boolean;
}

// ---- storage ---------------------------------------------------------------

interface SessionAreaLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

function sessionArea(): SessionAreaLike | null {
  if (typeof chrome === 'undefined') {
    return null;
  }
  const anyChrome = chrome as any;
  if (!anyChrome.storage?.session) {
    return null;
  }
  return anyChrome.storage.session as SessionAreaLike;
}

function localStorageArea(): StorageAreaLike {
  if (localOverride) {
    return localOverride;
  }
  if (typeof chrome === 'undefined') {
    return new MemoryStorageArea();
  }
  const anyChrome = chrome as any;
  if (!anyChrome.storage?.local) {
    return new MemoryStorageArea();
  }
  return new ChromeStorageArea();
}

let localOverride: StorageAreaLike | null = null;
let memoryReport: DedupReport | null = null;
let memoryUndo: UndoRecord | null = null;

async function readSession<T>(
  key: string,
  readMemory: () => T | null,
): Promise<T | null> {
  const area = sessionArea();
  if (!area) {
    return readMemory();
  }
  try {
    const items = await area.get([key]);
    const value = items[key];
    return value === undefined ? null : (value as T);
  } catch {
    return readMemory();
  }
}

async function writeSession(
  key: string,
  value: unknown,
  writeMemory: () => void,
): Promise<void> {
  writeMemory();
  const area = sessionArea();
  if (!area) {
    return;
  }
  try {
    if (value === null) {
      await area.remove([key]);
    } else {
      await area.set({ [key]: value });
    }
  } catch {
    // best effort: a lost report costs one scan
  }
}

export function getDedupReport(): Promise<DedupReport | null> {
  return readSession(REPORT_KEY, () => memoryReport);
}

function setDedupReport(report: DedupReport | null): Promise<void> {
  return writeSession(REPORT_KEY, report, () => {
    memoryReport = report;
  });
}

function getUndo(): Promise<UndoRecord | null> {
  return readSession(UNDO_KEY, () => memoryUndo);
}

function setUndo(undo: UndoRecord | null): Promise<void> {
  return writeSession(UNDO_KEY, undo, () => {
    memoryUndo = undo;
  });
}

async function loadIgnore(): Promise<string[]> {
  try {
    const raw = await localStorageArea().get([IGNORE_KEY]);
    const value = raw[IGNORE_KEY];
    return Array.isArray(value)
      ? value.filter((v) => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

async function saveIgnore(keys: string[]): Promise<void> {
  try {
    await localStorageArea().set({ [IGNORE_KEY]: keys });
  } catch (err) {
    logger.log('could not save the dedup ignore list', err);
  }
}

async function loadDismissed(): Promise<Record<string, number>> {
  try {
    const raw = await localStorageArea().get([DISMISSED_KEY]);
    const value = raw[DISMISSED_KEY];
    return value && typeof value === 'object'
      ? (value as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

async function saveDismissed(map: Record<string, number>): Promise<void> {
  try {
    await localStorageArea().set({ [DISMISSED_KEY]: map });
  } catch (err) {
    logger.log('could not save the dedup dismissals', err);
  }
}

// ---- the scan --------------------------------------------------------------

function chromeTabsApi(): DedupTabsApi {
  return {
    query: () => chrome.tabs.query({}),
    close: async (ids) => {
      await chrome.tabs.remove(ids);
    },
    open: async (tab) => {
      await chrome.tabs.create({
        url: tab.url,
        index: tab.index,
        windowId: tab.windowId >= 0 ? tab.windowId : undefined,
        pinned: tab.pinned,
      });
    },
  };
}

function toDedupTab(chromeTab: chrome.tabs.Tab): DedupTab {
  return {
    chromeTabId: chromeTab.id ?? -1,
    chromeWindowId: chromeTab.windowId ?? -1,
    url: chromeTab.url ?? '',
    title: chromeTab.title ?? '',
    pinned: chromeTab.pinned === true,
    active: chromeTab.active === true,
    audible: chromeTab.audible === true,
    lastAccessed:
      typeof chromeTab.lastAccessed === 'number'
        ? chromeTab.lastAccessed
        : undefined,
    index: typeof chromeTab.index === 'number' ? chromeTab.index : 0,
    background: isTabSpaceManagerPage(chromeTab),
  };
}

function emptyReport(scannedAt: number): DedupReport {
  return { scannedAt, windows: 0, tabs: 0, groups: [], fingerprint: '' };
}

async function resolveEnabled(): Promise<boolean> {
  await loadDedupSettings();
  return getDedupSettings().enabled === true;
}

async function readLiveTabs(api: DedupTabsApi): Promise<DedupTab[] | null> {
  try {
    const chromeTabs = await api.query();
    return chromeTabs.map(toDedupTab).filter((tab) => tab.chromeTabId >= 0);
  } catch (err) {
    logger.log('could not list tabs for dedup', err);
    return null;
  }
}

/**
 * One sweep. It never throws and never closes anything: it reads the open tabs
 * of the windows that hold a tabverse, groups the duplicates and stores the
 * report. A failed `tabs.query` leaves the previous report standing.
 */
export async function scanForDuplicates(
  options: DedupScanOptions = {},
): Promise<DedupReport> {
  const now = options.now ?? Date.now();
  const enabled = options.enabled ?? (await resolveEnabled());
  if (!enabled) {
    return emptyReport(now);
  }

  const api = options.tabs ?? chromeTabsApi();
  const live = await readLiveTabs(api);
  if (!live) {
    return (await getDedupReport()) ?? emptyReport(now);
  }

  // The remit is the windows that hold a tabverse (the same rule suspension
  // uses): a window with no manager tab is somebody else's tabs.
  const tabverseWindows = new Set(
    live.filter((tab) => tab.background).map((tab) => tab.chromeWindowId),
  );
  const considered = live.filter((tab) =>
    tabverseWindows.has(tab.chromeWindowId),
  );
  // A URL the person said to always ignore never reaches the report, so a
  // rescan after "Always ignore" cannot bring it straight back.
  const ignored = new Set(await loadIgnore());
  const groups = findDuplicateGroups(considered).filter(
    (group) => !ignored.has(group.key),
  );
  const report: DedupReport = {
    scannedAt: now,
    windows: tabverseWindows.size,
    tabs: considered.length,
    groups,
    fingerprint: reportFingerprint(groups),
  };
  await setDedupReport(report);
  return report;
}

async function isDismissed(fingerprint: string): Promise<boolean> {
  if (!fingerprint) {
    return false;
  }
  const map = await loadDismissed();
  const at = map[fingerprint];
  return typeof at === 'number' && Date.now() - at < DISMISS_TTL_MS;
}

/** The report the notice may draw: nothing when there is none, nothing to
 *  show, or the person already ignored this exact set. */
export async function visibleDedupReport(): Promise<DedupReport | null> {
  await loadDedupSettings();
  if (getDedupSettings().enabled !== true) {
    return null;
  }
  const report = await getDedupReport();
  if (!report || report.groups.length === 0) {
    return null;
  }
  if (await isDismissed(report.fingerprint)) {
    return null;
  }
  return report;
}

// ---- actions ---------------------------------------------------------------

/**
 * Close the reviewed duplicates. It re-derives the ids from the live tabs, so a
 * tab that navigated, was pinned or is gone since the report is not touched. It
 * records what it closed (bounded) so `Undo` can put it back.
 */
export async function applyDedup(
  fingerprint: string,
  options: DedupScanOptions = {},
): Promise<DedupReport | null> {
  const report = await getDedupReport();
  if (!report || report.fingerprint !== fingerprint) {
    return visibleDedupReport();
  }
  const api = options.tabs ?? chromeTabsApi();
  const live = await readLiveTabs(api);
  if (!live) {
    return visibleDedupReport();
  }
  const ignored = new Set(await loadIgnore());
  const ids = planDedupApply(report.groups, live, ignored);
  if (ids.length === 0) {
    return visibleDedupReport();
  }
  const byId = new Map(live.map((tab) => [tab.chromeTabId, tab]));
  const tabs: UndoableTab[] = [];
  for (const id of ids.slice(0, MAX_UNDO_TABS)) {
    const tab = byId.get(id);
    if (tab) {
      tabs.push({
        url: tab.url,
        index: tab.index,
        windowId: tab.chromeWindowId,
        pinned: tab.pinned,
      });
    }
  }
  await setUndo({ at: Date.now(), tabs });
  try {
    await api.close(ids);
  } catch (err) {
    // a tab can be closed between the check and the call; the next scan
    // reconciles whatever actually happened
    logger.log('could not close some duplicate tabs', err);
  }
  await scanForDuplicates(options);
  return visibleDedupReport();
}

/** Reopen what the last apply closed, best effort. */
export async function undoDedup(
  options: DedupScanOptions = {},
): Promise<DedupReport | null> {
  const undo = await getUndo();
  if (!undo || undo.tabs.length === 0) {
    return visibleDedupReport();
  }
  const api = options.tabs ?? chromeTabsApi();
  for (const tab of undo.tabs) {
    try {
      await api.open(tab);
    } catch (err) {
      logger.log('could not reopen a deduped tab', err);
    }
  }
  await setUndo(null);
  await scanForDuplicates(options);
  return visibleDedupReport();
}

/** Stop asking about this exact set for a while. */
export async function ignoreDedupFingerprint(
  fingerprint: string,
): Promise<void> {
  if (!fingerprint) {
    return;
  }
  const map = await loadDismissed();
  const now = Date.now();
  for (const [key, at] of Object.entries(map)) {
    if (now - at >= DISMISS_TTL_MS) {
      delete map[key];
    }
  }
  map[fingerprint] = now;
  await saveDismissed(map);
}

/** Never offer this URL again. */
export async function alwaysIgnoreDedupKey(
  key: string,
  options: DedupScanOptions = {},
): Promise<DedupReport | null> {
  if (!key) {
    return visibleDedupReport();
  }
  const list = await loadIgnore();
  if (!list.includes(key)) {
    list.push(key);
    await saveIgnore(list);
  }
  await scanForDuplicates(options);
  return visibleDedupReport();
}

// ---- the worker ------------------------------------------------------------

let lastPushedFingerprint: string | null = null;
let scanTimer: ReturnType<typeof setTimeout> | null = null;

function pushReport(report: DedupReport | null): void {
  const fingerprint = report?.fingerprint ?? null;
  if (fingerprint === lastPushedFingerprint) {
    return;
  }
  lastPushedFingerprint = fingerprint;
  void sendChromeMessage({
    type: DedupMsg.ReportChanged,
    payload: report ?? undefined,
  });
}

async function runScan(): Promise<void> {
  await loadDedupSettings();
  if (getDedupSettings().enabled !== true) {
    await setDedupReport(null);
    pushReport(null);
    return;
  }
  const report = await scanForDuplicates();
  const line = describeDedup(report);
  if (line) {
    logger.info(line);
  }
  pushReport(await visibleDedupReport());
}

function scheduleScan(): void {
  if (scanTimer) {
    clearTimeout(scanTimer);
  }
  scanTimer = setTimeout(() => {
    scanTimer = null;
    void runScan();
  }, SCAN_DEBOUNCE_MS);
}

async function ensureAlarm(): Promise<void> {
  await loadDedupSettings();
  const minutes = getDedupSettings().minutes ?? DEFAULT_DEDUP_SCAN_MINUTES;
  try {
    const existing = await chrome.alarms.get(DEDUP_ALARM);
    if (existing && existing.periodInMinutes === minutes) {
      return;
    }
    await chrome.alarms.clear(DEDUP_ALARM);
    await chrome.alarms.create(DEDUP_ALARM, { periodInMinutes: minutes });
    logger.info(`dedup scan alarm set (every ${minutes} minutes)`);
  } catch (err) {
    logger.log('could not set the dedup alarm', err);
  }
}

/**
 * Start the advisor in the service worker: one alarm, a scan once per browser
 * run, and a debounced scan on tab events. Tab events never scan inline - they
 * only mark the report stale and schedule - so nothing the person does waits on
 * the advisor.
 */
export function startDedupScanner(): void {
  void ensureAlarm();

  void (async () => {
    const existing = await getDedupReport();
    if (existing) {
      pushReport(await visibleDedupReport());
      return;
    }
    await runScan();
  })();

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === DEDUP_ALARM) {
      void runScan();
    }
  });
  chrome.tabs.onCreated.addListener(scheduleScan);
  chrome.tabs.onUpdated.addListener(scheduleScan);
  chrome.tabs.onRemoved.addListener(scheduleScan);
  chrome.tabs.onActivated.addListener(scheduleScan);

  const anyChrome = chrome as any;
  anyChrome.windows?.onFocusChanged?.addListener?.(scheduleScan);
  anyChrome.storage?.onChanged?.addListener?.(
    (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') {
        return;
      }
      if (DEDUP_ENABLED_KEY in changes || DEDUP_SCAN_MINUTES_KEY in changes) {
        void ensureAlarm();
        void runScan();
      }
    },
  );
}

/**
 * The worker's half of the page protocol. Returns true when the message was
 * handled (and `sendResponse` will be called), false to let another listener
 * see it.
 */
export function handleDedupMessage(
  message: { type?: string; payload?: unknown },
  sendResponse: (response?: unknown) => void,
): boolean {
  const payload = typeof message.payload === 'string' ? message.payload : '';
  switch (message.type) {
    case DedupMsg.RequestReport:
      void visibleDedupReport().then((report) => sendResponse(report));
      return true;
    case DedupMsg.Apply:
      void applyDedup(payload).then((report) => sendResponse(report));
      return true;
    case DedupMsg.Ignore:
      void ignoreDedupFingerprint(payload).then(() => {
        lastPushedFingerprint = null;
        void visibleDedupReport().then((report) => sendResponse(report));
      });
      return true;
    case DedupMsg.AlwaysIgnore:
      void alwaysIgnoreDedupKey(payload).then((report) => sendResponse(report));
      return true;
    case DedupMsg.Undo:
      void undoDedup().then((report) => {
        lastPushedFingerprint = null;
        sendResponse(report);
      });
      return true;
    default:
      return false;
  }
}

/** Test hooks: the local storage area and the cached report/undo. */
export function setDedupStorageForTest(area: StorageAreaLike | null): void {
  localOverride = area;
  memoryReport = null;
  memoryUndo = null;
  lastPushedFingerprint = null;
}

export function setDedupReportForTest(report: DedupReport | null): void {
  memoryReport = report;
}

export { DEDUP_ALARM };
