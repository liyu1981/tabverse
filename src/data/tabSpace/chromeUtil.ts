import { TabSpaceOp } from '../../global';
import { Tab } from './Tab';
import { getNewId } from '../common';
import { logger } from '../../global';
import { sendChromeMessage, TabSpaceMsg } from '../../message/message';
import { concat } from 'lodash';

/**
 * The one place a Tabverse tab's url is built.
 *
 * Every Tabverse tab carries its tabverse id as `tvid`: a tabverse is born
 * saved, so the id exists before the first save and has to survive a reload
 * (the in-memory tabspace is rebuilt from scratch on every page load). The
 * opener mints the id for a new tabverse, which is also what makes "open a
 * Tabverse tab" and "keep this window" the same action.
 */
export function tabverseUrl(op: TabSpaceOp, tabSpaceId?: string): string {
  const tvid = tabSpaceId ?? getNewId();
  return `manager.html?op=${op}&tvid=${encodeURIComponent(tvid)}`;
}

/**
 * Pins the tabverse's own tab and puts it at the very front of its window, i.e.
 * first in the pinned section.
 *
 * The explicit move is not redundant: where Chrome *inserts* a newly pinned tab
 * is its own business, and during a restore we pin the tabverse's own pinned
 * tabs *after* the manager tab was pinned - without this the manager tab would
 * end up behind them, and the tabverse would no longer be the thing you see
 * first when you look at the window.
 *
 * We only do this on our own actions (page load, restore). We deliberately do
 * not fight the user: if they later pin or drag another tab to the front, that
 * sticks.
 */
export async function pinTabverseTabFirst(chromeTabId: number): Promise<void> {
  try {
    await chrome.tabs.update(chromeTabId, {
      pinned: true,
      autoDiscardable: false,
    });
    await chrome.tabs.move(chromeTabId, { index: 0 });
  } catch (err) {
    // the window can be closed under us during bootstrap; not worth failing on
    logger.log('could not put the tabverse tab first', chromeTabId, err);
  }
}

export function switchToTabSpaceUtil(
  chromeTabId: number,
  chromeWindowId: number,
  willSendChromeMessage = true,
) {
  if (willSendChromeMessage) {
    sendChromeMessage({
      type: TabSpaceMsg.Focus,
      payload: chromeTabId,
    });
  }
  chrome.windows.update(chromeWindowId, { focused: true });
}

/**
 * Brings a live tab to the front, in its own window if that window is behind.
 *
 * The failure is logged and swallowed rather than thrown: the tab can be closed
 * between the list being drawn and the click landing, and a tabverse row that
 * throws on click is worse than a click that does nothing.
 */
export async function focusLiveTabUtil(targetTab: Tab): Promise<void> {
  if (targetTab.chromeTabId < 0) {
    return;
  }
  try {
    await chrome.tabs.update(targetTab.chromeTabId, { active: true });
    if (targetTab.chromeWindowId >= 0) {
      await chrome.windows.update(targetTab.chromeWindowId, { focused: true });
    }
  } catch (err) {
    logger.log('could not switch to the tab', targetTab.id, err);
  }
}

/**
 * Puts a window's tabs in a given order.
 *
 * Restoring reuses the tabs the window already has (see restorePlan.ts), and
 * those sit wherever they were left, so the tab strip would otherwise end up in
 * a different order from the tabverse list - which is the one thing the list is
 * for. One pass, moving each tab that is not already where it belongs: the
 * shortest set of moves is not worth working out for a window's worth of tabs.
 *
 * The order is taken as given, with the tabverse's own pinned tab expected at
 * the front, so only pinned tabs are asked to move inside the pinned section.
 * A tab that cannot be moved (it was closed meanwhile, or the browser refused)
 * is logged and skipped: the next save reconciles whatever order we ended up
 * with.
 */
export async function orderWindowTabs(
  windowId: number,
  desiredChromeTabIds: number[],
): Promise<void> {
  const current = await chrome.tabs.query({ windowId });
  for (let index = 0; index < desiredChromeTabIds.length; index++) {
    const wantedId = desiredChromeTabIds[index];
    const from = current.findIndex((tab) => tab.id === wantedId);
    if (from < 0 || from === index) {
      continue;
    }
    try {
      await chrome.tabs.move(wantedId, { index });
      // keep our own copy in step, so the next tab is placed against reality
      const [moved] = current.splice(from, 1);
      current.splice(index, 0, moved);
    } catch (err) {
      logger.log('could not move tab into place', wantedId, err);
    }
  }
}

/**
 * Opens a new window, hands it to `tabCreateFn` and closes the tabs Chrome put
 * there by default. Used when restoring a saved tabverse into a new window.
 */
export async function createNewChromeWindowWithTab(
  tabCreateFn: (chromeWindow: chrome.windows.Window) => Promise<any>[],
): Promise<chrome.windows.Window> {
  const chromeWindow = await chrome.windows.create({ focused: true });
  const existingTabs = await chrome.tabs.query({ windowId: chromeWindow.id });
  const allPromises = concat([], tabCreateFn(chromeWindow));
  existingTabs.forEach((tab) => {
    allPromises.push(chrome.tabs.remove(tab.id));
  });
  await Promise.all(allPromises);
  return chromeWindow;
}

export function restoreSavedTabSpaceUtil(tabSpaceId: string) {
  chrome.windows.create((window) => {
    chrome.tabs.create({
      active: true,
      pinned: true,
      url: tabverseUrl(TabSpaceOp.LoadSaved, tabSpaceId),
      windowId: window.id,
    });
  });
}

export function loadToCurrentWindowUtil(savedTabSpaceId: string) {
  window.open(tabverseUrl(TabSpaceOp.LoadSaved, savedTabSpaceId), '_self');
}
