import { IBase, setAttrForObject2 } from '../common';
import { convertToSavedBase, newEmptyBase, toBase } from '../Base';
import { List } from 'immutable';
import { eq, omit } from 'lodash';

import { NotTabSpaceId } from '../common';

export interface TabCore extends IBase {
  tabSpaceId: string;
  title: string;
  url: string;
  favIconUrl: string;
  pinned: boolean;
  suspended: boolean;
  /**
   * The id of the *other* tab in this tab's split view, when it has one.
   *
   * The pairing is part of the tabverse, so it is saved and synced (ADR 0022): a
   * split is how the window looked, and a saved tabverse that has forgotten it
   * reads as a flat list of the very same tabs.
   *
   * It is written as the partner's tab id rather than as Chrome's
   * `splitViewId`, because that id is scoped to the browser session that issued
   * it. Two devices on one account each have a "split view 7", and reading
   * those as one block would pair up four tabs that have nothing to do with each
   * other - in the console, where nobody is in the window to check. A tab id
   * means the same thing on every device.
   */
  splitWith?: string;
}

export interface LiveTab {
  chromeTabId: number;
  chromeWindowId: number;
  /**
   * Chrome's answer about this tab's split view, and it is a *tri-state*:
   *
   *   - a number: the tab is in that split view;
   *   - `SPLIT_VIEW_ID_NONE`: Chrome says the tab is **not** in a split. This is
   *     a value, not an absence, and it is the answer that retires a pairing;
   *   - `undefined`: Chrome has no opinion - a browser before 140, or a tab that
   *     is not in this window (restored from the record, read by the console).
   *
   * Collapsing the middle case into the last one is what made a closed split
   * indistinguishable from a tab nobody has looked at, and a closed split could
   * then not be retired (ADR 0022). Session scoped like chromeTabId, so it is
   * not part of TabCore and is never what a saved tabverse or the console reads:
   * the pairing travels as `TabCore.splitWith` instead. Reading it needs Chrome
   * 140+ (see src/capabilities.ts); creating a split needs 155+, which is why
   * there is no write path yet.
   */
  splitViewId?: number;
}

/**
 * Chrome's "this tab is not in a split view", kept as our own constant so the
 * data layer does not have to reach for a `chrome` global (ADR 0022).
 *
 * The same -1 Chrome and the mock use. It is spelled out here rather than read
 * from `chrome.tabs` because two tabs both holding it must never be read as a
 * pair, and that is a rule about the data, not about the browser.
 */
export const SPLIT_VIEW_ID_NONE = -1;

export type Tab = TabCore & LiveTab;
export type TabSavePayload = TabCore;

export const TAB_DB_TABLE_NAME = 'SavedTab';
export const TAB_DB_SCHEMA = 'id, title, url, createdAt';

export function newEmptyTab(): Tab {
  return {
    ...newEmptyBase(),
    tabSpaceId: NotTabSpaceId,
    title: '',
    url: '',
    favIconUrl: '',
    pinned: false,
    suspended: false,
    chromeTabId: -1,
    chromeWindowId: -1,
    splitViewId: undefined,
    splitWith: undefined,
  };
}

export const setId = setAttrForObject2<string, Tab>('id');
export const setTabSpaceId = setAttrForObject2<string, Tab>('tabSpaceId');
export const setTitle = setAttrForObject2<string, Tab>('title');
export const setUrl = setAttrForObject2<string, Tab>('url');
export const setFavIconUrl = setAttrForObject2<string, Tab>('favIconUrl');
export const setPinned = setAttrForObject2<boolean, Tab>('pinned');
export const setChromeTabId = setAttrForObject2<number, Tab>('chromeTabId');
export const setChromeWindowId = setAttrForObject2<number, Tab>(
  'chromeWindowId',
);

export function fromSavedTab(savedTab: TabSavePayload): Tab {
  return { ...newEmptyTab(), ...savedTab };
}

export function fromLiveTab(liveTab: LiveTab): Tab {
  return { ...newEmptyTab(), ...liveTab };
}

/**
 * The other tab of this tab's split view, if any.
 *
 * Two sources, in order of trust. `splitWith` is the saved pairing and names its
 * partner by tab id, so it reads the same on every device and is the answer for
 * anything that came off disk or off the server. `splitViewId` is Chrome's own
 * id for the pair, and is all a live tabverse has until it is saved.
 *
 * Either way the pairing is only ever used to draw: recreating a split needs a
 * Chrome version this extension cannot ask for yet (ADR 0022), so a restored
 * tabverse shows its splits as blocks and opens flat.
 */
export function findSplitPartner(
  targetTab: Tab,
  allTabs: List<Tab>,
): Tab | undefined {
  if (targetTab.splitWith) {
    const named = allTabs.find(
      (tab) => tab.id === targetTab.splitWith && tab.id !== targetTab.id,
    );
    if (named) {
      return named;
    }
    // A partner that is not in this tabverse - deleted since, or never saved -
    // is not a partner. Fall through: the tab may still be split in the window.
  }
  return findSplitPartnerByChromeId(targetTab, allTabs);
}

/**
 * The other tab of this tab's split view, by Chrome's own id for the pair.
 *
 * Split view holds exactly two tabs (chrome.tabs.createSplit), so the pair is
 * found by scanning. This is the *live* truth; `splitWith` is what gets written
 * from it at save time.
 *
 * Chrome's "not in a split" (`SPLIT_VIEW_ID_NONE`) is refused on the way in,
 * because the scan would otherwise pair every unsplit tab in the tabverse with
 * every other one - they all share the same -1.
 */
export function findSplitPartnerByChromeId(
  targetTab: Tab,
  allTabs: List<Tab>,
): Tab | undefined {
  const id = targetTab.splitViewId;
  if (id === undefined || id === SPLIT_VIEW_ID_NONE) {
    return undefined;
  }
  return allTabs.find(
    (tab) => tab.id !== targetTab.id && tab.splitViewId === id,
  );
}

export function toTabCore(targetTab: Tab): TabCore {
  return {
    ...toBase(targetTab),
    tabSpaceId: targetTab.tabSpaceId,
    title: targetTab.title,
    url: targetTab.url,
    favIconUrl: targetTab.favIconUrl,
    pinned: targetTab.pinned,
    suspended: targetTab.suspended,
    splitWith: targetTab.splitWith,
  };
}

export function convertAndGetTabSavePayload(
  targetTab: Tab,
  savedTabSpaceId: string,
): {
  tab: Tab;
  savedTab: TabSavePayload;
} {
  const savedBase = convertToSavedBase(targetTab);
  const tab = {
    ...targetTab,
    ...savedBase,
    tabSpaceId: savedTabSpaceId,
  };
  const savedTab = {
    ...toTabCore(targetTab),
    ...savedBase,
    tabSpaceId: savedTabSpaceId,
  };
  return { tab, savedTab };
}

export function isEqualWithoutCreatedAtUpdatedAt(t1: Tab, t2: Tab): boolean {
  return eq(
    omit(t1, ['createdAt', 'updatedAt']),
    omit(t2, ['createdAt', 'updatedAt']),
  );
}
