import { Tab } from './Tab';

/**
 * What a restore into a window should do, before it touches the browser.
 *
 * Loading a saved tabverse used to be "close every tab in the window, then open
 * every tab of the tabverse". That is right about the *result* and wasteful
 * about the way there: a tab the user already has open in that window is closed
 * and opened again, which loses its place, its scroll position, its back
 * history, and (for anything with a session in it) its state. So the restore
 * looks at the window first and reuses what is already there.
 *
 * The decision is here, on its own, because it is the part worth testing: which
 * saved tabs find an open tab to stand for, which have to be opened, and which
 * of the window's tabs are in neither. The chrome calls live in `util.ts`.
 */

/**
 * The parts of a window tab the plan needs. `id` is optional because that is
 * how @types/chrome declares it; a tab without one cannot be reused, closed or
 * moved, so the plan drops it.
 */
export interface WindowTabForPlan {
  id?: number;
  url?: string;
}

export interface RestorePlanEntry {
  savedTab: Tab;
  /**
   * The open tab this saved tab reuses, or undefined when it has to be opened.
   * There is at most one of these per window tab, so a tabverse holding the
   * same url twice does not collapse into one tab.
   */
  reuseChromeTabId?: number;
  /** What the tab should end up pinned as, taken from the saved row. */
  pinned: boolean;
}

export interface RestorePlan {
  /** One entry per saved tab, in saved order. */
  entries: RestorePlanEntry[];
  /** The saved tabs with nothing open to stand for them. */
  createTabs: Tab[];
  /** The window's tabs that are neither the tabverse tab nor part of the plan. */
  removeChromeTabIds: number[];
}

/**
 * Two urls that are the same page to a person looking at them.
 *
 * Chrome reports the url it navigated to, which is not always the string that
 * was saved: a page redirects from `/x` to `/x/`, a link is clicked with a
 * fragment that never reaches the server, and the host is case insensitive
 * while the path is not. So the fragment goes, a trailing slash goes, and the
 * origin is lowercased - and nothing else is touched, because `/Page` and
 * `/page` really are two different pages.
 */
export function normalizedTabUrl(url: string | undefined | null): string {
  if (!url) {
    return '';
  }
  const withoutFragment = url.split('#')[0];
  const originAndRest = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)(.*)$/i.exec(
    withoutFragment,
  );
  if (!originAndRest) {
    // about:blank, a file:// path with no authority, anything unusual
    return withoutFragment.replace(/\/+$/, '');
  }
  const origin = originAndRest[1].toLowerCase();
  const rest = originAndRest[2].replace(/\/+$/, '');
  return `${origin}${rest}`;
}

/** Whether an open tab and a saved tab are the same page. */
export function isSameTabUrl(
  openUrl: string | undefined,
  savedUrl: string | undefined,
): boolean {
  const open = normalizedTabUrl(openUrl);
  return open.length > 0 && open === normalizedTabUrl(savedUrl);
}

/**
 * Plans a restore of `savedTabs` into the window holding `windowTabs`.
 *
 * `tabverseChromeTabId` is the manager tab of the restore itself. It is never
 * reused (it is the page doing the restoring, not a tab of the tabverse) and
 * never closed - which is also why it is not in `windowTabs` to begin with on
 * any sane call.
 */
export function planRestore(
  savedTabs: readonly Tab[],
  windowTabs: readonly WindowTabForPlan[],
  tabverseChromeTabId: number,
): RestorePlan {
  // normalized url -> the open tabs with that url, in the window's own order
  const openTabIdsByUrl = new Map<string, number[]>();
  for (const tab of windowTabs) {
    if (tab.id === undefined || tab.id === tabverseChromeTabId) {
      continue;
    }
    const key = normalizedTabUrl(tab.url);
    if (key.length <= 0) {
      // a tab that has not navigated anywhere yet is not a page to reuse
      continue;
    }
    const ids = openTabIdsByUrl.get(key);
    if (ids) {
      ids.push(tab.id);
    } else {
      openTabIdsByUrl.set(key, [tab.id]);
    }
  }

  const claimedChromeTabIds = new Set<number>();
  const entries: RestorePlanEntry[] = [];
  for (const savedTab of savedTabs) {
    const candidates = openTabIdsByUrl.get(normalizedTabUrl(savedTab.url));
    // one open tab stands for one saved tab, however many of either there are
    const reuseChromeTabId = candidates?.find(
      (id) => !claimedChromeTabIds.has(id),
    );
    if (reuseChromeTabId !== undefined) {
      claimedChromeTabIds.add(reuseChromeTabId);
    }
    entries.push({ savedTab, reuseChromeTabId, pinned: !!savedTab.pinned });
  }

  return {
    entries,
    createTabs: entries
      .filter((entry) => entry.reuseChromeTabId === undefined)
      .map((entry) => entry.savedTab),
    removeChromeTabIds: windowTabs
      .filter(
        (tab) =>
          tab.id !== undefined &&
          tab.id !== tabverseChromeTabId &&
          !claimedChromeTabIds.has(tab.id),
      )
      .map((tab) => tab.id as number),
  };
}
