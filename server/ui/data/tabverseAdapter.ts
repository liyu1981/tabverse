/**
 * A tabverse as the server stored it, turned into the shape the extension's own
 * view code draws (`adr/0019`).
 *
 * The console is handed a `TabspaceBundle`: the tabverse row, its decoded
 * payload (where the tab groups live), and every record hanging off it, already
 * sorted by the client's own ordering. `tabverseEntries` wants the extension's
 * `TabSpace` - tabs as an immutable `List`, groups as hints - so this is the
 * only place that has to know about both.
 *
 * Two fields are lies on purpose, and both matter:
 *
 *  - **`chromeTabId` is 0, not -1.** The extension's "no live tab" sentinel is
 *    `-1`, which is truthy; `TabCard` asks `chromeTabId > 0` before it offers a
 *    close button, and a stored tab has no live tab in this browser at all. A
 *    non-zero value here would put a button on every row of somebody else's
 *    account that calls `chrome.tabs.remove()`.
 *  - **`createdAt` is 0.** Nothing in the tabverse view draws a per-tab time, and
 *    a bundle row carries `updated_at` but not the tab's own creation stamp.
 *    Inventing one (say, from the tabverse's) would be a fact the server does
 *    not have.
 */

import { List } from 'immutable';

import type { Tab } from '../../../src/data/tabSpace/Tab';
import type {
  TabGroupHint,
  TabSpace,
} from '../../../src/data/tabSpace/TabSpace';
import type { BundleRow, TabspaceBundle } from './types';

/** The group hints in a bundle's own payload, in the order it lists them. */
export function bundleGroups(bundle: TabspaceBundle): TabGroupHint[] {
  const raw = bundle.tabspace_data?.tabGroups;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((group) => group && typeof group === 'object')
    .map((group) => ({
      id: String(group.id ?? ''),
      title: typeof group.title === 'string' ? group.title : '',
      color: group.color,
      tabIds: Array.isArray(group.tabIds) ? group.tabIds.map(String) : [],
    }));
}

/** One stored row as the card draws it. */
export function toStoredTab(row: BundleRow, tabspaceId: string): Tab {
  const data = row.data ?? {};
  return {
    id: row.id,
    tabSpaceId: tabspaceId,
    title: typeof data.title === 'string' ? data.title : '',
    url: typeof data.url === 'string' ? data.url : '',
    favIconUrl: typeof data.favIconUrl === 'string' ? data.favIconUrl : '',
    pinned: data.pinned === true,
    suspended: data.suspended === true,
    // The bundle knows when the record was last written and nothing else about
    // the tab's own timeline.
    createdAt: 0,
    updatedAt: row.updated_at,
    version: 0,
    // "Not a live tab in this browser", said in the one way the card reads:
    // `> 0`. See the note at the top.
    chromeTabId: 0,
    chromeWindowId: 0,
  };
}

/**
 * The bundle as the `TabSpace` `tabverseEntries` and `TabCard` draw.
 *
 * The tabs come in the order the server sent them, which is the order the
 * tabverse's own `tabIds` gives (ADR 0015: the server reads the client's
 * ordering lists rather than re-deriving them), and `tabverseEntries` keeps that
 * order and only moves a group to where its first member is.
 */
export function toTabSpace(bundle: TabspaceBundle): TabSpace {
  return {
    id: bundle.tabspace.id,
    name: bundle.tabspace.name || '',
    tabs: List(
      [...bundle.tabs]
        .sort((a, b) => a.position - b.position)
        .map((row) => toStoredTab(row, bundle.tabspace.id)),
    ),
    tabGroups: bundleGroups(bundle),
    createdAt: bundle.tabspace.created_at,
    updatedAt: bundle.tabspace.updated_at,
    version: 0,
    // The tabverse itself is not open in this browser either.
    chromeTabId: 0,
    chromeWindowId: 0,
  };
}
