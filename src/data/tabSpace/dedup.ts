/**
 * Duplicate tabs, as a pure function of what Chrome already says.
 *
 * The whole feature is advisor-only (adr/0033): this file decides *what* is a
 * duplicate and *which* copy is kept, and never touches a tab. The worker
 * (`dedupScan.ts`) is the only thing that reads `chrome.tabs`; the notice
 * (`DedupAdvisorNotice`) is the only thing that asks to close one, and it asks
 * the worker rather than closing anything itself.
 *
 * The rules, all testable with no browser:
 *
 *  - a **duplicate** is two or more open tabs in the same window whose URL
 *    normalises to the same key; the window is the tabverse's remit;
 *  - the **keeper** is chosen by one deterministic comparator - active, then
 *    audible, then pinned, then newest `lastAccessed`, then lowest index - so
 *    two scans agree and a person can predict it;
 *  - a **closer** is every other copy that is not pinned, not audible and not
 *    the tabverse manager tab; a group whose every extra copy is protected is
 *    reported with a reason instead of an action;
 *  - `planDedupApply` re-derives the ids from the *live* tabs, so a stale report
 *    can never close a tab that has since changed or gone.
 */

export interface DedupTab {
  chromeTabId: number;
  chromeWindowId: number;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  /** `chrome.tabs.Tab.lastAccessed`, undefined before Chrome 121. */
  lastAccessed: number | undefined;
  index: number;
  /** The tabverse manager tab: never a duplicate, never a closer. */
  background: boolean;
}

/** Just the fields the notice draws, so a report is small and self-contained. */
export interface DuplicateTabRef {
  chromeTabId: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
}

export interface DuplicateGroup {
  /** `duplicateKey(url)`, and the key "always ignore this URL" stores. */
  key: string;
  /** The keeper's url, for display. */
  url: string;
  windowId: number;
  keeper: DuplicateTabRef;
  closers: DuplicateTabRef[];
  /** Set when there is nothing safe to close, e.g. "all other copies are pinned". */
  protectedReason?: string;
}

export interface DedupReport {
  scannedAt: number;
  /** Tabverse windows seen (the windows a scan looked at). */
  windows: number;
  /** Tabs considered, i.e. open tabs in those windows. */
  tabs: number;
  /** Only groups with at least two members; protected ones are included. */
  groups: DuplicateGroup[];
  /** Changes when the actionable set changes, so an "Ignore" can expire with it. */
  fingerprint: string;
}

/**
 * The URL identity rule. `undefined` means "this is not a web page and is never
 * a duplicate": browser internals, files, extension pages. Two URLs are the same
 * page when scheme, host, path and query agree; the fragment is dropped (it is
 * a position within the page, not another page) and a trailing slash is
 * normalised away. Query parameters are kept in v1 - a tracking parameter may
 * make two URLs not match, which is a missed duplicate rather than a wrong one
 * (the plan's open question 1).
 */
export function duplicateKey(rawUrl: string): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return undefined;
  }
  // `URL` already lowercases the host and drops a default port.
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

function toRef(tab: DedupTab): DuplicateTabRef {
  return {
    chromeTabId: tab.chromeTabId,
    title: tab.title,
    url: tab.url,
    pinned: tab.pinned,
    active: tab.active,
    audible: tab.audible,
  };
}

/**
 * True when `a` should be kept over `b`: active beats background, audible beats
 * silent, pinned beats unpinned, then the most recently accessed, then the
 * lowest index (so the earliest tab in the strip wins a full tie).
 */
function keeperBeats(a: DedupTab, b: DedupTab): boolean {
  if (a.active !== b.active) return a.active;
  if (a.audible !== b.audible) return a.audible;
  if (a.pinned !== b.pinned) return a.pinned;
  const aAt = a.lastAccessed ?? -1;
  const bAt = b.lastAccessed ?? -1;
  if (aAt !== bAt) return aAt > bAt;
  if (a.index !== b.index) return a.index < b.index;
  return a.chromeTabId < b.chromeTabId;
}

/** Why nothing in a group can be closed, or undefined when something can. */
function protectedReason(others: DedupTab[]): string | undefined {
  if (others.length === 0) {
    return undefined;
  }
  if (others.every((tab) => tab.pinned)) {
    return 'all other copies are pinned';
  }
  if (others.every((tab) => tab.audible)) {
    return 'all other copies are playing audio';
  }
  if (others.every((tab) => tab.pinned || tab.audible)) {
    return 'every other copy is pinned or playing audio';
  }
  return undefined;
}

/**
 * The duplicate groups worth a notice. Pure: no chrome, no clock. Groups are
 * ordered by how much there is to remove, then URL, so the notice is stable.
 */
export function findDuplicateGroups(tabs: DedupTab[]): DuplicateGroup[] {
  const buckets = new Map<string, DedupTab[]>();
  for (const tab of tabs) {
    if (tab.background) {
      continue;
    }
    const key = duplicateKey(tab.url);
    if (!key) {
      continue;
    }
    const id = `${tab.chromeWindowId}\u0000${key}`;
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.push(tab);
    } else {
      buckets.set(id, [tab]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) {
      continue;
    }
    const sorted = [...bucket].sort((a, b) => (keeperBeats(a, b) ? -1 : 1));
    const keeper = sorted[0];
    const others = sorted.slice(1);
    const closers = others.filter(
      (tab) => !tab.pinned && !tab.audible && !tab.background,
    );
    const key = duplicateKey(keeper.url);
    if (!key) {
      continue;
    }
    const group: DuplicateGroup = {
      key,
      url: keeper.url,
      windowId: keeper.chromeWindowId,
      keeper: toRef(keeper),
      closers: closers.map(toRef),
    };
    if (closers.length === 0) {
      group.protectedReason = protectedReason(others);
    }
    groups.push(group);
  }

  groups.sort(
    (a, b) => b.closers.length - a.closers.length || a.url.localeCompare(b.url),
  );
  return groups;
}

/** A short, stable digest of the actionable set, for "Ignore" bookkeeping. */
export function reportFingerprint(groups: DuplicateGroup[]): string {
  const parts = groups
    .filter((group) => group.closers.length > 0)
    .map(
      (group) =>
        `${group.key}:${group.closers
          .map((closer) => closer.chromeTabId)
          .sort((a, b) => a - b)
          .join('.')}`,
    );
  parts.sort();
  let hash = 5381;
  const joined = parts.join('|');
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * The ids that are safe to close *now*.
 *
 * The report was made some time ago; between then and a press of "Remove
 * duplicates" a tab can have navigated, been pinned, started playing or been
 * closed. Every closer is therefore re-checked against the live tabs - same
 * normalised URL, still unpinned, still silent, still present - and a group the
 * person ignored is skipped.
 */
export function planDedupApply(
  groups: DuplicateGroup[],
  live: DedupTab[],
  ignored: Set<string>,
): number[] {
  const liveById = new Map(live.map((tab) => [tab.chromeTabId, tab]));
  const ids = new Set<number>();
  for (const group of groups) {
    if (ignored.has(group.key)) {
      continue;
    }
    for (const closer of group.closers) {
      const tab = liveById.get(closer.chromeTabId);
      if (!tab || tab.pinned || tab.audible || tab.background) {
        continue;
      }
      if (duplicateKey(tab.url) !== group.key) {
        continue;
      }
      ids.add(closer.chromeTabId);
    }
  }
  return [...ids];
}

/** One line for the worker log, or '' when there is nothing to say. */
export function describeDedup(report: DedupReport): string {
  const actionable = report.groups.filter((group) => group.closers.length > 0);
  if (actionable.length === 0) {
    return '';
  }
  const closers = actionable.reduce(
    (sum, group) => sum + group.closers.length,
    0,
  );
  return `dedup: ${closers} duplicate tab(s) in ${actionable.length} group(s)`;
}
