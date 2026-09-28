import { TabSpaceOp } from '../../global';
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
 * Opens a new window, hands it to `tabCreateFn` and closes the tabs Chrome put
 * there by default. Used when restoring a saved tabverse into a new window.
 */
export async function createNewChromeWindowWithTab(
  tabCreateFn: (chromeWindow: chrome.windows.Window) => Promise<any>[],
): Promise<chrome.windows.Window> {
  const chromeWindow = await chrome.windows.create({ focused: true });
  const existingTabs = await chrome.tabs.query({ windowId: chromeWindow.id });
  const allPromises = concat([], tabCreateFn(chromeWindow));
  existingTabs.forEach((tab) => allPromises.push(chrome.tabs.remove(tab.id)));
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
