import { isTabSpaceManagerPage, logger } from '../../global';

/**
 * Which tabverses are open, and where.
 *
 * ADR 0006 gave this up: a manager page only ever knew about the tabverse of
 * its own window, because the cross-window registry (leader election over a
 * broadcast channel) was not worth its cost. The popup can answer the
 * question much more cheaply, and it is the place that needs the answer: a
 * list of saved tabverses where the user may want to *go to* one rather than
 * open a copy of it.
 *
 * It is one `chrome.tabs.query({})` and a map, with no state to keep
 * consistent, so none of the machinery that made the old registry hard comes
 * back. Every manager page carries its tabverse id in its url as `tvid` (see
 * `tabverseUrl`), which is what makes the mapping possible without any
 * bookkeeping on our side.
 */

/** One open tabverse: the tab that is its manager page, and its window. */
export interface OpenTabSpace {
  tabSpaceId: string;
  chromeTabId: number;
  chromeWindowId: number;
}

/** The tabverse id a tabverse manager page carries, or '' if it has none. */
export function tabSpaceIdOfManagerTab(tab: chrome.tabs.Tab): string {
  if (tab.id === undefined || !isTabSpaceManagerPage(tab)) {
    return '';
  }
  // the url is chrome-extension://<id>/manager.html?op=...&tvid=...
  const matched = /[?&]tvid=([^&]+)/.exec(tab.url ?? '');
  if (!matched) {
    return '';
  }
  try {
    return decodeURIComponent(matched[1]);
  } catch {
    return matched[1];
  }
}

function isOpenTabSpace(tab: chrome.tabs.Tab): tab is chrome.tabs.Tab & {
  id: number;
} {
  return tab.id !== undefined && isTabSpaceManagerPage(tab);
}

/**
 * Every tabverse that is open in some window.
 *
 * A tabverse can be open in more than one window (that is allowed, one page
 * per window), so the result may hold the same id twice: callers that care
 * count windows, callers that switch take the first.
 */
export function openTabSpacesOf(tabs: chrome.tabs.Tab[]): OpenTabSpace[] {
  return tabs
    .filter(isOpenTabSpace)
    .map((tab) => ({
      tabSpaceId: tabSpaceIdOfManagerTab(tab),
      chromeTabId: tab.id,
      chromeWindowId: tab.windowId,
    }))
    .filter((open) => open.tabSpaceId.length > 0);
}

export async function queryOpenTabSpaces(): Promise<OpenTabSpace[]> {
  try {
    const tabs = await chrome.tabs.query({});
    return openTabSpacesOf(tabs);
  } catch (err) {
    // the popup is a nicety here: a tabs.query failure should show an empty
    // list, not an empty popup
    logger.error('could not read the open tabs', err);
    return [];
  }
}

/** The tabverse open in this window, if any (at most one, ADR 0006). */
export function openTabSpaceOfWindow(
  openTabSpaces: OpenTabSpace[],
  windowId: number,
): OpenTabSpace | undefined {
  return openTabSpaces.find((open) => open.chromeWindowId === windowId);
}

/** How many windows a tabverse is open in. */
export function windowCountOfTabSpace(
  openTabSpaces: OpenTabSpace[],
  tabSpaceId: string,
): number {
  return openTabSpaces.filter((open) => open.tabSpaceId === tabSpaceId).length;
}

/**
 * Puts a tabverse url in a window, reusing that window's manager tab if it has
 * one.
 *
 * Navigating the existing tab is what keeps this working: a window may only
 * hold one manager page (`manager.tsx` bails with CountExit when it finds a
 * second one), so "open in this window" cannot simply add a tab.
 */
export async function openTabverseUrlInWindow(
  url: string,
  windowId: number,
  openTabSpaces: OpenTabSpace[],
): Promise<void> {
  const existing = openTabSpaceOfWindow(openTabSpaces, windowId);
  if (existing) {
    await chrome.tabs.update(existing.chromeTabId, { url });
    return;
  }
  await chrome.tabs.create({ url, windowId, active: true });
}

/** Brings the window that has this tabverse to the front, on its own tab. */
export async function switchToOpenTabSpace(
  openTabSpace: OpenTabSpace,
): Promise<void> {
  await chrome.tabs.update(openTabSpace.chromeTabId, { active: true });
  await chrome.windows.update(openTabSpace.chromeWindowId, { focused: true });
}
