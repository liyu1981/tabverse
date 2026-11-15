/**
 * Auto grouping's Chrome half: the only file in the feature that groups a tab.
 *
 * The decision was made and edited in the dialog (`autoGroup.ts`,
 * `AutoGroupDialog`); this takes the choices, re-validates them against the
 * window **as Chrome has it now**, and performs `tabs.group` +
 * `tabGroups.update` per surviving group.
 *
 * The API is injectable, like `DedupTabsApi` and `MarkdownRunner`: the tests
 * drive create-versus-extend, the "the group is gone, create a new one instead"
 * fallback and the per-group failure accounting with a fake, and no browser is
 * involved. In production `chromeAutoGroupApi()` is the only thing here that
 * touches `chrome.*`.
 */
import { logger } from '../../global';
import type { Tab } from './Tab';
import type { TabGroupColor } from './TabSpace';
import { type AutoGroupChoice, planAutoGroupApply } from './autoGroup';
import { chromeGroupIdOf } from './tabGroup';

/** The live tabs of a window, as Chrome answers right now. */
export interface AutoGroupLiveTab {
  chromeTabId: number;
  url: string;
}

/** The four Chrome calls this feature needs, plus what it has to ask the page. */
export interface AutoGroupChromeApi {
  queryTabs(windowId: number): Promise<AutoGroupLiveTab[]>;
  /** A new group over these tabs; returns Chrome's group id. */
  groupNew(chromeTabIds: number[], windowId: number): Promise<number>;
  /** Adds these tabs to an existing group; returns its Chrome id. */
  groupInto(chromeGroupId: number, chromeTabIds: number[]): Promise<number>;
  updateGroup(
    chromeGroupId: number,
    patch: { title?: string; color?: TabGroupColor },
  ): Promise<void>;
  /** Our stable group id -> the Chrome id of the group, if it still exists. */
  chromeGroupIdOf(ourGroupId: string): number | undefined;
}

function chromeTabIdsOf(ids: number[]): [number, ...number[]] {
  // `tabs.group` wants a non-empty tuple; callers never pass an empty list
  return ids as [number, ...number[]];
}

export function chromeAutoGroupApi(): AutoGroupChromeApi {
  return {
    queryTabs: async (windowId) => {
      const tabs = await chrome.tabs.query({ windowId });
      return tabs
        .filter(
          (tab): tab is chrome.tabs.Tab & { id: number } =>
            typeof tab.id === 'number',
        )
        .map((tab) => ({ chromeTabId: tab.id, url: tab.url ?? '' }));
    },
    groupNew: (chromeTabIds, windowId) =>
      chrome.tabs.group({
        tabIds: chromeTabIdsOf(chromeTabIds),
        createProperties: { windowId },
      }),
    groupInto: (chromeGroupId, chromeTabIds) =>
      chrome.tabs.group({
        groupId: chromeGroupId,
        tabIds: chromeTabIdsOf(chromeTabIds),
      }),
    updateGroup: async (chromeGroupId, patch) => {
      await chrome.tabGroups.update(chromeGroupId, patch);
    },
    chromeGroupIdOf,
  };
}

/** What happened, in the counts the toast reads. */
export interface AutoGroupApplyReport {
  /** Groups created or extended. */
  groups: number;
  /** Tabs that ended up in one of them. */
  tabs: number;
  /** Tabs the choices named that were gone or had left their site. */
  droppedTabs: number;
  /** Groups left with fewer than two live tabs, so not applied. */
  droppedGroups: number;
  /** Groups Chrome refused (a tab closed between the check and the call). */
  failed: number;
}

export interface AutoGroupApplyReportWithCounts extends AutoGroupApplyReport {
  /** Groups that became a new Chrome group. */
  created: number;
  /** Groups whose tabs were added to a group that already existed. */
  extended: number;
}

export interface ApplyAutoGroupOptions {
  windowId: number;
  /**
   * The page's own tab list, which is the only place our tab ids and Chrome's
   * tab ids are known together. The urls used for re-validation come from
   * Chrome, not from this - it is a day (or a tab event) old by definition.
   */
  tabs: readonly Tab[];
  api?: AutoGroupChromeApi;
}

/**
 * Applies the choices; never throws.
 *
 * The choices are re-validated first (`planAutoGroupApply`): a tab that is gone,
 * a tab that navigated away from the site the choice was about, and a group
 * left with fewer than two tabs all stop here, and the report says how many.
 * Each surviving group is then applied on its own, so one refused group (a tab
 * closed between the check and the call) does not take the rest with it.
 */
export async function applyAutoGroupChoices(
  choices: readonly AutoGroupChoice[],
  options: ApplyAutoGroupOptions,
): Promise<AutoGroupApplyReportWithCounts> {
  const api = options.api ?? chromeAutoGroupApi();
  const report: AutoGroupApplyReportWithCounts = {
    created: 0,
    extended: 0,
    groups: 0,
    tabs: 0,
    droppedTabs: 0,
    droppedGroups: 0,
    failed: 0,
  };
  if (choices.length === 0) {
    return report;
  }

  let live: AutoGroupLiveTab[];
  try {
    live = await api.queryTabs(options.windowId);
  } catch (err) {
    logger.log('auto group: could not read the window tabs', err);
    report.failed = choices.length;
    return report;
  }
  const liveByChromeId = new Set(live.map((tab) => tab.chromeTabId));
  const liveTabs = options.tabs
    .filter((tab) => liveByChromeId.has(tab.chromeTabId) && tab.chromeTabId > 0)
    .map((tab) => ({
      tabId: tab.id,
      chromeTabId: tab.chromeTabId,
      url: live.find((t) => t.chromeTabId === tab.chromeTabId)?.url ?? tab.url,
    }));

  const plan = planAutoGroupApply(choices, liveTabs);
  report.droppedTabs = plan.droppedTabs;
  report.droppedGroups = plan.droppedGroups;

  for (const group of plan.groups) {
    try {
      let chromeGroupId: number;
      const existing =
        group.kind === 'extend' && group.groupId
          ? api.chromeGroupIdOf(group.groupId)
          : undefined;
      if (existing !== undefined) {
        chromeGroupId = await api.groupInto(existing, group.chromeTabIds);
        report.extended += 1;
      } else {
        // either a create, or an extend whose group has gone since the scan
        chromeGroupId = await api.groupNew(
          group.chromeTabIds,
          options.windowId,
        );
        report.created += 1;
      }
      try {
        await api.updateGroup(chromeGroupId, {
          title: group.title,
          color: group.color,
        });
      } catch (err) {
        // the tabs are grouped; a title/colour left at Chrome's default is a
        // cosmetic miss, not a failed group
        logger.log('auto group: could not title the new group', err);
      }
      report.groups += 1;
      report.tabs += group.chromeTabIds.length;
    } catch (err) {
      logger.log('auto group: could not group some tabs', err);
      report.failed += 1;
    }
  }
  return report;
}
