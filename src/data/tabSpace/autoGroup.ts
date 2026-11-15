/**
 * Auto grouping: the grouping plan, as a pure function of the window.
 *
 * The whole feature is a *suggestion* (`doc/tabverse-auto-grouping-plan.md`):
 * this file decides what could be grouped and never touches a tab. Applying it
 * is `autoGroupChrome.ts`; the button and the dialog are
 * `ui/manager/TabSpace/AutoGroupDialog`.
 *
 * Two planners produce the same shape, so the dialog and the apply path do not
 * care where a suggestion came from:
 *
 *  - **by site**, below: tabs that share a registrable domain, plus the case
 *    where an existing group already owns that domain and the plan would only
 *    *add* to it;
 *  - **with the on-device model**, `src/ai/grouping.ts`: topic clusters, whose
 *    reply is validated here (`suggestionsFromAi`) before it becomes a
 *    suggestion.
 *
 * The rules that are easy to get wrong, and so are written down once:
 *
 *  - a plan never moves a tab **out** of a group it is in, never merges two
 *    groups, and never groups a pinned tab (Chrome forbids a group that mixes
 *    pinned and unpinned tabs);
 *  - only **http(s)** tabs are grouped: `chrome://`, `file://` and extension
 *    pages are not "sites", and a group of browser settings is noise;
 *  - a group of **one** is not a group, so a lone tab is reported as skipped;
 *  - the plan is **deterministic** - colour, title and order are a function of
 *    the tabs - so two scans agree and a person can predict it.
 */

import type { Tab } from './Tab';
import {
  type TabGroupColor,
  type TabGroupHint,
  TAB_GROUP_COLORS,
} from './TabSpace';
import { groupOfTab } from './tabGroup';

/** Cap on suggestions, so a 200-tab window does not open a wall of groups. */
export const AUTO_GROUP_MAX_GROUPS = 12;

/** A group needs two tabs; one is the "not a group" case. */
export const AUTO_GROUP_MIN_TABS = 2;

/**
 * The multi-label public suffixes this feature knows: enough for the ordinary
 * two-part endings (`co.uk`) and the hosting platforms people actually keep
 * several tabs on (`github.io`). A full public-suffix list is megabytes and
 * this is a grouping heuristic, not a security boundary - an unknown suffix
 * groups by its last two labels, which is the same answer as a human's.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'ac.uk',
  'co.in',
  'co.jp',
  'co.nz',
  'co.uk',
  'co.za',
  'com.au',
  'com.br',
  'com.cn',
  'com.hk',
  'com.sg',
  'com.tr',
  'com.tw',
  'edu.au',
  'gov.uk',
  'net.au',
  'net.nz',
  'ne.jp',
  'org.au',
  'org.nz',
  'org.uk',
  'or.jp',
  // hosting platforms: the registrable domain is one label deeper
  'azurewebsites.net',
  'blogspot.com',
  'cloudfront.net',
  'github.io',
  'gitlab.io',
  'herokuapp.com',
  'netlify.app',
  'pages.dev',
  'vercel.app',
]);

/**
 * The registrable site of a url, or null when it is not a web page.
 *
 * `https://www.github.com/a/b` -> `github.com`; `https://docs.github.io/x` ->
 * `docs.github.io`; an IP host is its own key. Null for every non-http(s)
 * scheme (the manager tab, browser pages, files).
 */
export function siteKeyOf(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return null;
  }
  // IPv4 / IPv6: no labels to group by
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    return host;
  }
  const labels = host.split('.').filter(Boolean);
  if (labels[0] === 'www') {
    labels.shift();
  }
  if (labels.length <= 2) {
    return labels.join('.');
  }
  const lastTwo = labels.slice(-2).join('.');
  return labels.slice(-(MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2)).join('.');
}

/** A person-facing name for a site key: `github.com` -> `Github`. */
export function siteLabelOf(key: string): string {
  const first = key.split('.')[0] ?? key;
  if (!first) {
    return key;
  }
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export interface AutoGroupSuggestionTab {
  tabId: string;
  chromeTabId: number;
  title: string;
  url: string;
  /** For the card's row; the picture itself is fetched by the page. */
  favIconUrl: string;
}

export interface AutoGroupSuggestion {
  /** `create:<site key>` or `extend:<our group id>`; stable across renders. */
  id: string;
  kind: 'create' | 'extend';
  /** Our group id, for an extend. */
  groupId?: string;
  /** The site key this came from (empty for an AI suggestion). */
  key: string;
  title: string;
  color: TabGroupColor;
  tabs: AutoGroupSuggestionTab[];
}

/** Tabs a plan deliberately left alone, counted by why. */
export interface AutoGroupSkipped {
  /** Pinned: Chrome refuses to mix them into a group. */
  pinned: number;
  /** Not an http(s) page (browser pages, files, the manager tab itself). */
  notWebPage: number;
  /** Already in a group; a plan never moves a tab out. */
  alreadyGrouped: number;
  /** Ungrouped, but alone on its site: a group of one is not a group. */
  singletons: number;
}

export interface AutoGroupPlan {
  suggestions: AutoGroupSuggestion[];
  skipped: AutoGroupSkipped;
}

function emptySkipped(): AutoGroupSkipped {
  return { pinned: 0, notWebPage: 0, alreadyGrouped: 0, singletons: 0 };
}

function tabRefOf(tab: Tab): AutoGroupSuggestionTab {
  return {
    tabId: tab.id,
    chromeTabId: tab.chromeTabId,
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
  };
}

/**
 * The tabs a plan may touch, in the list's order, plus what was left out.
 *
 * `groups` is the window's group hints: a tab in one is `alreadyGrouped` and
 * leaves the candidate set entirely, which is what makes "never move a tab out
 * of a group" a property of the data rather than a rule every later step has to
 * remember.
 */
export function autoGroupCandidates(
  tabs: readonly Tab[],
  groups: readonly TabGroupHint[],
): { candidates: Tab[]; skipped: AutoGroupSkipped } {
  const skipped = emptySkipped();
  const candidates: Tab[] = [];
  for (const tab of tabs) {
    if (tab.pinned) {
      skipped.pinned += 1;
      continue;
    }
    if (siteKeyOf(tab.url) === null || tab.chromeTabId <= 0) {
      skipped.notWebPage += 1;
      continue;
    }
    if (groupOfTab(groups as TabGroupHint[], tab.id)) {
      skipped.alreadyGrouped += 1;
      continue;
    }
    candidates.push(tab);
  }
  return { candidates, skipped };
}

/** A random source; injected so a plan's colours are testable. */
export type RandomSource = () => number;

/**
 * A colour for a new group: **picked at random**, avoiding the colours the
 * window's existing groups (and the plan's earlier suggestions) already wear -
 * two groups of the same colour are two groups a person cannot tell apart at a
 * glance. When every colour is in use the draw stands.
 *
 * Random rather than derived from the site: a suggestion is a proposal, not a
 * record, and a colour that is a function of the host name reads as if it meant
 * something. The one thing worth keeping stable - the plan under the cursor -
 * is stable because the dialog computes it once and edits it in place.
 */
export function pickGroupColor(
  used: Iterable<TabGroupColor>,
  random: RandomSource = Math.random,
): TabGroupColor {
  const taken = new Set(used);
  const free = TAB_GROUP_COLORS.filter((color) => !taken.has(color));
  const pool = free.length > 0 ? free : TAB_GROUP_COLORS;
  const draw = random();
  const index = Number.isFinite(draw)
    ? Math.min(Math.max(Math.floor(draw * pool.length), 0), pool.length - 1)
    : 0;
  return pool[index];
}

/**
 * The site most of a group's tabs belong to, or null when it has none.
 *
 * A group can hold several sites (a person grouped them by hand), so an
 * "extend this group with more github tabs" plan is only offered when one site
 * is the group's clear majority.
 */
export function dominantSiteOfGroup(
  group: TabGroupHint,
  tabs: readonly Tab[],
): string | null {
  const counts = new Map<string, number>();
  for (const tabId of group.tabIds) {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    const key = siteKeyOf(tab?.url);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The plan, by site: one suggestion per grouping action.
 *
 * Existing groups come first (extend), because a tab can only join one group
 * and the person has already said what it belongs to; then the ungrouped sites,
 * biggest first.
 */
export function suggestAutoGroups(
  tabs: readonly Tab[],
  groups: readonly TabGroupHint[],
  random: RandomSource = Math.random,
): AutoGroupPlan {
  const { candidates, skipped } = autoGroupCandidates(tabs, groups);
  const suggestions: AutoGroupSuggestion[] = [];
  // existing colours first, then each suggestion's own: the plan's groups are
  // as distinguishable from each other as from the ones already on screen
  const usedColors = new Set<TabGroupColor>(groups.map((group) => group.color));
  const byKey = new Map<string, Tab[]>();
  for (const tab of candidates) {
    const key = siteKeyOf(tab.url);
    if (!key) {
      continue;
    }
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(tab);
    } else {
      byKey.set(key, [tab]);
    }
  }

  // extend: a group whose tabs are mostly one site, plus ungrouped tabs of it
  const claimed = new Set<string>();
  for (const group of groups) {
    const key = dominantSiteOfGroup(group, tabs);
    if (!key) {
      continue;
    }
    const extra = byKey.get(key) ?? [];
    if (extra.length <= 0) {
      continue;
    }
    suggestions.push({
      id: `extend:${group.id}`,
      kind: 'extend',
      groupId: group.id,
      key,
      title: group.title || siteLabelOf(key),
      color: group.color,
      tabs: extra.map(tabRefOf),
    });
    extra.forEach((tab) => {
      claimed.add(tab.id);
    });
  }

  // create: the remaining sites with two or more tabs
  for (const [key, bucket] of byKey) {
    const remaining = bucket.filter((tab) => !claimed.has(tab.id));
    if (remaining.length < AUTO_GROUP_MIN_TABS) {
      skipped.singletons += remaining.length;
      continue;
    }
    const color = pickGroupColor(usedColors, random);
    usedColors.add(color);
    suggestions.push({
      id: `create:${key}`,
      kind: 'create',
      key,
      title: siteLabelOf(key),
      color,
      tabs: remaining.map(tabRefOf),
    });
    remaining.forEach((tab) => {
      claimed.add(tab.id);
    });
  }

  suggestions.sort(
    (a, b) => b.tabs.length - a.tabs.length || a.key.localeCompare(b.key),
  );
  return {
    suggestions: suggestions.slice(0, AUTO_GROUP_MAX_GROUPS),
    skipped,
  };
}

/** One proposal as the model answered it: indexes into the candidate list. */
export interface AiGroupProposal {
  title: string;
  /** Any string; sanitised against the nine Chrome colours here. */
  color?: string;
  /** 1-based candidate numbers, as the prompt numbered them. */
  tabIndexes: number[];
}

const MAX_GROUP_TITLE_CHARS = 40;

/** Control characters become spaces, by code point (naming.ts's rule). */
function withoutControlChars(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out;
}

function cleanGroupTitle(title: unknown, fallback: string): string {
  const text = withoutControlChars(String(title ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["']+/, '')
    .replace(/["']+$/, '');
  return text.slice(0, MAX_GROUP_TITLE_CHARS) || fallback;
}

/**
 * The model's reply, as suggestions over the candidates it was shown.
 *
 * The model is not trusted with the decision, only asked for an opinion: an
 * index it invented, a tab it put in two groups, a group left with one tab, a
 * colour that is not Chrome's - all of it is handled here, and a proposal that
 * does not survive becomes nothing (or a smaller group), never an error the
 * person cannot act on.
 */
export function suggestionsFromAi(
  proposals: readonly AiGroupProposal[],
  candidates: readonly Tab[],
  usedColors: readonly TabGroupColor[] = [],
  random: RandomSource = Math.random,
): AutoGroupSuggestion[] {
  const suggestions: AutoGroupSuggestion[] = [];
  const claimed = new Set<string>();
  const used = new Set<TabGroupColor>(usedColors);
  let index = 0;
  for (const proposal of proposals) {
    const tabs: AutoGroupSuggestionTab[] = [];
    for (const candidateNumber of proposal.tabIndexes) {
      const tab = candidates[candidateNumber - 1];
      if (!tab || claimed.has(tab.id)) {
        continue;
      }
      claimed.add(tab.id);
      tabs.push(tabRefOf(tab));
    }
    if (tabs.length < AUTO_GROUP_MIN_TABS) {
      continue;
    }
    let color: TabGroupColor;
    if (
      (TAB_GROUP_COLORS as readonly string[]).includes(String(proposal.color))
    ) {
      color = proposal.color as TabGroupColor;
    } else {
      // the model's colour is not one of Chrome's: draw one, so a bad answer
      // costs the colour and not the group
      color = pickGroupColor(used, random);
    }
    used.add(color);
    suggestions.push({
      id: `ai:${index}`,
      kind: 'create',
      key: '',
      title: cleanGroupTitle(
        proposal.title,
        siteLabelOf(siteKeyOf(tabs[0].url) ?? ''),
      ),
      color,
      tabs,
    });
    index += 1;
  }
  return suggestions.slice(0, AUTO_GROUP_MAX_GROUPS);
}

/** What the dialog hands to the apply path: only what survived its edits. */
export interface AutoGroupChoice {
  kind: 'create' | 'extend';
  /** Our group id, for an extend. */
  groupId?: string;
  /**
   * The site key, when the choice came from the site planner: apply drops a tab
   * whose url no longer has that site. AI groups have no key (a topic is not a
   * site), so only "the tab still exists" is checked for them.
   */
  key?: string;
  title: string;
  color: TabGroupColor;
  tabIds: string[];
}

/** One group to create or extend, with the live chrome ids it will touch. */
export interface AutoGroupApplyGroup {
  kind: 'create' | 'extend';
  /** Our group id, for an extend; the caller maps it to Chrome's. */
  groupId?: string;
  title: string;
  color: TabGroupColor;
  chromeTabIds: number[];
}

export interface AutoGroupApplyPlan {
  groups: AutoGroupApplyGroup[];
  /** Tabs the choices mentioned that are gone or no longer fit. */
  droppedTabs: number;
  /** Groups left with fewer than two live tabs, so not applied. */
  droppedGroups: number;
}

/**
 * The choices, re-derived against the **live** window.
 *
 * The dialog can be open while tabs close and navigate, so what Apply executes
 * is decided from what Chrome says now, not from the dialog's snapshot - the
 * same rule as `planDedupApply`. A gone tab and a tab whose url no longer
 * belongs to the choice's site are both dropped, and a group that falls under
 * two tabs is not applied at all.
 */
export function planAutoGroupApply(
  choices: readonly AutoGroupChoice[],
  liveTabs: readonly { tabId: string; chromeTabId: number; url: string }[],
): AutoGroupApplyPlan {
  const liveById = new Map<string, { chromeTabId: number; url: string }>();
  for (const tab of liveTabs) {
    liveById.set(tab.tabId, { chromeTabId: tab.chromeTabId, url: tab.url });
  }
  const groups: AutoGroupApplyGroup[] = [];
  let droppedTabs = 0;
  let droppedGroups = 0;
  for (const choice of choices) {
    const seen = new Set<number>();
    const chromeTabIds: number[] = [];
    for (const tabId of choice.tabIds) {
      const live = liveById.get(tabId);
      if (!live || live.chromeTabId <= 0) {
        droppedTabs += 1;
        continue;
      }
      if (choice.key && siteKeyOf(live.url) !== choice.key) {
        // navigated away from the site this choice was about
        droppedTabs += 1;
        continue;
      }
      if (seen.has(live.chromeTabId)) {
        continue;
      }
      seen.add(live.chromeTabId);
      chromeTabIds.push(live.chromeTabId);
    }
    if (chromeTabIds.length < AUTO_GROUP_MIN_TABS) {
      droppedGroups += 1;
      continue;
    }
    groups.push({
      kind: choice.kind,
      groupId: choice.groupId,
      title: choice.title,
      color: choice.color,
      chromeTabIds,
    });
  }
  return { groups, droppedTabs, droppedGroups };
}
