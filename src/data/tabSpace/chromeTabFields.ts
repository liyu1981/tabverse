import { Tab } from './Tab';

import { produce } from 'immer';

/**
 * What a live chrome tab says about one of our tabs.
 *
 * Only the fields that describe the tab itself are copied, and each one is
 * copied only when chrome has something to say: an unloaded tab has no title,
 * no favicon and (before it navigates) no url, and those are the fields a
 * restore of a *kept* tab must not blank out.
 *
 * Split view is the exception, because it is the one field where chrome's
 * silence is not the absence of an answer: `SPLIT_VIEW_ID_NONE` is a value, and
 * it is how chrome says "this tab is not in a split view". It is copied through
 * as it is, so a closed split can be told apart from a tab nobody has looked
 * at (ADR 0022). Storing it as `undefined` - which is what this used to do -
 * made those two the same thing, and a closed split could then never retire the
 * pairing it had written.
 */
export function copyChromeTabFields(
  chromeTab: chrome.tabs.Tab,
  targetTab: Tab,
): Tab {
  return produce(targetTab, (draft) => {
    if (chromeTab.title) {
      draft.title = chromeTab.title;
    }
    if (chromeTab.url) {
      draft.url = chromeTab.url;
    }
    if (chromeTab.favIconUrl) {
      draft.favIconUrl = chromeTab.favIconUrl;
    }
    if (chromeTab.pinned) {
      draft.pinned = chromeTab.pinned;
    }
    if (chromeTab.discarded) {
      draft.suspended = chromeTab.discarded;
    }
    if (chromeTab.splitViewId !== undefined) {
      draft.splitViewId = chromeTab.splitViewId;
    }
  });
}
