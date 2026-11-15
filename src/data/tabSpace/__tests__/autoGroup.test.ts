/**
 * The auto-grouping plan, as a pure function of the window.
 *
 * What is pinned here is the part that decides what a person is offered:
 * which tabs are eligible, when a site becomes a group, when the plan adds to a
 * group instead of making one, what the model's reply is allowed to become, and
 * what the re-validation at Apply time throws away.
 */
import { expect, test } from 'vitest';

import type { Tab } from '../Tab';
import {
  TAB_GROUP_COLORS,
  type TabGroupColor,
  type TabGroupHint,
} from '../TabSpace';
import {
  AUTO_GROUP_MAX_GROUPS,
  autoGroupCandidates,
  dominantSiteOfGroup,
  pickGroupColor,
  planAutoGroupApply,
  siteKeyOf,
  siteLabelOf,
  suggestAutoGroups,
  suggestionsFromAi,
} from '../autoGroup';

function tab(id: string, url: string, overrides: Partial<Tab> = {}): Tab {
  return {
    version: 11,
    id,
    createdAt: 1,
    updatedAt: 1,
    tabSpaceId: 'ts1',
    title: `title of ${id}`,
    url,
    favIconUrl: '',
    pinned: false,
    suspended: false,
    chromeTabId: Number(id.replace(/\D/g, '')) || 1,
    chromeWindowId: 10,
    splitViewId: undefined,
    splitWith: undefined,
    ...overrides,
  };
}

function group(
  id: string,
  title: string,
  color: TabGroupColor,
  tabIds: string[],
): TabGroupHint {
  return { id, title, color, tabIds };
}

test('a site key is the registrable domain, or null for a non-web page', () => {
  expect(siteKeyOf('https://www.github.com/a/b?q=1')).toBe('github.com');
  expect(siteKeyOf('http://GITHUB.com')).toBe('github.com');
  expect(siteKeyOf('https://docs.github.io/x')).toBe('docs.github.io');
  expect(siteKeyOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
  expect(siteKeyOf('https://example.co.uk')).toBe('example.co.uk');
  expect(siteKeyOf('http://192.168.0.1:8080/x')).toBe('192.168.0.1');
  expect(siteKeyOf('chrome://settings')).toBeNull();
  expect(siteKeyOf('file:///tmp/a.txt')).toBeNull();
  expect(siteKeyOf('chrome-extension://abc/manager.html')).toBeNull();
  expect(siteKeyOf('not a url')).toBeNull();
  expect(siteKeyOf(undefined)).toBeNull();
});

test('a site label is the first label, capitalised', () => {
  expect(siteLabelOf('github.com')).toBe('Github');
  expect(siteLabelOf('bbc.co.uk')).toBe('Bbc');
  expect(siteLabelOf('192.168.0.1')).toBe('192');
});

test('pinned, grouped and non-web tabs are left out of the candidates', () => {
  const tabs = [
    tab('1', 'https://a.com/1'),
    tab('2', 'https://a.com/2', { pinned: true }),
    tab('3', 'https://b.com/1'),
    tab('4', 'chrome://settings'),
    tab('5', 'https://a.com/3', { chromeTabId: -1 }),
  ];
  const { candidates, skipped } = autoGroupCandidates(tabs, [
    group('g1', 'B', 'blue', ['3']),
  ]);

  expect(candidates.map((candidate) => candidate.id)).toEqual(['1']);
  expect(skipped).toMatchObject({
    pinned: 1,
    notWebPage: 2,
    alreadyGrouped: 1,
  });
});

test('a site with two or more ungrouped tabs becomes a group', () => {
  const plan = suggestAutoGroups(
    [
      tab('1', 'https://www.example.com/a'),
      tab('2', 'https://example.com/b'),
      tab('3', 'https://other.com/a'),
    ],
    [],
  );

  expect(plan.suggestions).toHaveLength(1);
  expect(plan.suggestions[0]).toMatchObject({
    id: 'create:example.com',
    kind: 'create',
    key: 'example.com',
    title: 'Example',
  });
  expect(plan.suggestions[0].tabs.map((entry) => entry.tabId)).toEqual([
    '1',
    '2',
  ]);
  expect(plan.skipped.singletons).toBe(1);
});

test('suggestions are ordered by how many tabs they cover, then by key', () => {
  const plan = suggestAutoGroups(
    [
      tab('1', 'https://small.com/a'),
      tab('2', 'https://small.com/b'),
      tab('3', 'https://big.com/a'),
      tab('4', 'https://big.com/b'),
      tab('5', 'https://big.com/c'),
    ],
    [],
  );

  expect(plan.suggestions.map((suggestion) => suggestion.key)).toEqual([
    'big.com',
    'small.com',
  ]);
});

test('the plan is capped, so a huge window does not open a wall of groups', () => {
  const tabs = Array.from({ length: AUTO_GROUP_MAX_GROUPS + 5 }, (_, index) =>
    tab(`${index * 2 + 1}`, `https://site${index}.com/a`),
  );
  const tabs2 = Array.from({ length: AUTO_GROUP_MAX_GROUPS + 5 }, (_, index) =>
    tab(`${index * 2 + 2}`, `https://site${index}.com/b`),
  );
  const plan = suggestAutoGroups([...tabs, ...tabs2], []);
  expect(plan.suggestions).toHaveLength(AUTO_GROUP_MAX_GROUPS);
});

/**
 * Colours are drawn at random, but never one the window is already using: two
 * groups of the same colour are two groups a person cannot tell apart. The
 * draw is injected so a plan's colours are testable; `Math.random` is the
 * production source.
 */
test('a new group draws a colour, and not one already in use', () => {
  const used: TabGroupColor[] = ['grey', 'blue', 'red'];
  // palette order is grey, blue, red, yellow, green, pink, purple, cyan, orange
  expect(pickGroupColor(used, () => 0)).toBe('yellow');
  expect(pickGroupColor(used, () => 0.999)).toBe('orange');
  // a draw that lands on a taken colour is an impossibility, not a coin flip:
  // the pool only holds the free ones
  expect(['grey', 'blue', 'red']).not.toContain(pickGroupColor(used, () => 0));
});

test('when every colour is in use the draw still gives one', () => {
  const all: TabGroupColor[] = [...TAB_GROUP_COLORS];
  expect(TAB_GROUP_COLORS).toContain(pickGroupColor(all, () => 0));
});

test('the groups of one plan are drawn distinct colours', () => {
  let draws = 0;
  const plan = suggestAutoGroups(
    [
      tab('1', 'https://a.com/1'),
      tab('2', 'https://a.com/2'),
      tab('3', 'https://b.com/1'),
      tab('4', 'https://b.com/2'),
      tab('5', 'https://c.com/1'),
      tab('6', 'https://c.com/2'),
    ],
    [],
    () => {
      draws += 1;
      return 0;
    },
  );

  const colors = plan.suggestions.map((suggestion) => suggestion.color);
  expect(colors).toHaveLength(3);
  expect(new Set(colors).size).toBe(3);
  expect(draws).toBe(3);
});

test('the plan is random: two scans of the same tabs can differ', () => {
  const tabs = [tab('1', 'https://a.com/1'), tab('2', 'https://a.com/2')];
  const first = suggestAutoGroups(tabs, [], () => 0);
  const second = suggestAutoGroups(tabs, [], () => 0.999);
  expect(first.suggestions[0].color).not.toBe(second.suggestions[0].color);
});

test('an existing group of a site is extended with its remaining tabs', () => {
  const tabs = [
    tab('1', 'https://github.com/a'),
    tab('2', 'https://github.com/b'),
    tab('3', 'https://github.com/c'),
  ];
  const plan = suggestAutoGroups(tabs, [
    group('g1', 'Work', 'purple', ['1', '2']),
  ]);

  expect(plan.suggestions).toHaveLength(1);
  expect(plan.suggestions[0]).toMatchObject({
    id: 'extend:g1',
    kind: 'extend',
    groupId: 'g1',
    title: 'Work',
    color: 'purple',
  });
  expect(plan.suggestions[0].tabs.map((entry) => entry.tabId)).toEqual(['3']);
});

test('a site whose tabs are all in a group is not suggested again', () => {
  const plan = suggestAutoGroups(
    [tab('1', 'https://github.com/a'), tab('2', 'https://github.com/b')],
    [group('g1', 'Work', 'purple', ['1', '2'])],
  );
  expect(plan.suggestions).toEqual([]);
});

test('the dominant site of a group is the one most of its tabs belong to', () => {
  const tabs = [
    tab('1', 'https://a.com/1'),
    tab('2', 'https://a.com/2'),
    tab('3', 'https://b.com/1'),
  ];
  expect(
    dominantSiteOfGroup(group('g', 'mixed', 'grey', ['1', '2', '3']), tabs),
  ).toBe('a.com');
  expect(
    dominantSiteOfGroup(group('g', 'none', 'grey', ['missing']), tabs),
  ).toBeNull();
});

/**
 * The model's reply is an opinion, not the decision: these are the rules that
 * keep a reply from grouping a tab that was never offered, from putting a tab
 * in two groups, or from naming a group with a wall of text.
 */
test('AI proposals keep only tabs that were offered, once each', () => {
  const candidates = [
    tab('1', 'https://a.com/1'),
    tab('2', 'https://b.com/1'),
    tab('3', 'https://a.com/2'),
    tab('4', 'https://c.com/1'),
  ];
  const suggestions = suggestionsFromAi(
    [
      { title: 'Work', color: 'blue', tabIndexes: [1, 2, 2, 99] },
      { title: 'Reading', color: 'green', tabIndexes: [2, 3] },
      { title: 'Too small', color: 'red', tabIndexes: [4, 99] },
      { title: '', color: 'not-a-colour', tabIndexes: [4, 3] },
    ],
    candidates,
  );

  // the first group keeps 1 and 2; 2 is not taken by "Reading"; the group of
  // one is dropped; the last group's tabs are already claimed
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0].tabs.map((entry) => entry.tabId)).toEqual(['1', '2']);
  expect(suggestions[0].title).toBe('Work');
  expect(suggestions[0].color).toBe('blue');
});

test('an AI group with a bad colour gets a drawn one, not a broken group', () => {
  const suggestions = suggestionsFromAi(
    [{ title: 'Reading', color: 'chartreuse', tabIndexes: [1, 2] }],
    [tab('1', 'https://a.com/1'), tab('2', 'https://b.com/1')],
    [],
    () => 0,
  );
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0].color).not.toBe('chartreuse');
  expect(suggestions[0].id).toBe('ai:0');
});

test('an AI title is one line, trimmed, and capped', () => {
  const long = `${'x'.repeat(80)}\nsecond line`;
  const [suggestion] = suggestionsFromAi(
    [{ title: long, tabIndexes: [1, 2] }],
    [tab('1', 'https://a.com/1'), tab('2', 'https://b.com/1')],
  );
  expect(suggestion.title).not.toContain('\n');
  expect(suggestion.title.length).toBeLessThanOrEqual(40);
});

/**
 * Apply re-derives everything from live tabs, so a dialog left open while tabs
 * close or navigate cannot group the wrong ones.
 */
test('applying drops tabs that are gone, and tabs that left the site', () => {
  const choice = {
    kind: 'create' as const,
    key: 'a.com',
    title: 'A',
    color: 'blue' as TabGroupColor,
    tabIds: ['1', '2', '3'],
  };
  const plan = planAutoGroupApply(
    [choice],
    [
      { tabId: '1', chromeTabId: 101, url: 'https://a.com/x' },
      // '2' is gone
      { tabId: '3', chromeTabId: 103, url: 'https://elsewhere.com/x' },
    ],
  );

  expect(plan.groups).toEqual([]);
  expect(plan.droppedGroups).toBe(1);
  expect(plan.droppedTabs).toBe(2);
});

test('applying a group left with one live tab does not create it', () => {
  const plan = planAutoGroupApply(
    [
      {
        kind: 'create' as const,
        title: 'A',
        color: 'blue' as TabGroupColor,
        tabIds: ['1', '2'],
      },
    ],
    [{ tabId: '1', chromeTabId: 101, url: 'https://a.com/x' }],
  );
  expect(plan.groups).toEqual([]);
  expect(plan.droppedGroups).toBe(1);
});

test('applying maps our tab ids to the live chrome ids, once each', () => {
  const plan = planAutoGroupApply(
    [
      {
        kind: 'create' as const,
        title: 'A',
        color: 'blue' as TabGroupColor,
        tabIds: ['1', '1', '2'],
      },
    ],
    [
      { tabId: '1', chromeTabId: 101, url: 'https://a.com/x' },
      { tabId: '2', chromeTabId: 102, url: 'https://a.com/y' },
    ],
  );
  expect(plan.groups).toHaveLength(1);
  expect(plan.groups[0].chromeTabIds).toEqual([101, 102]);
});
