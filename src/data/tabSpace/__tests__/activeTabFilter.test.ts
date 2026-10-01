import { Tab } from '../Tab';
import {
  activeTabFilterTerms,
  filterActiveTabs,
  isActiveTabFilterActive,
  matchActiveTabs,
} from '../activeTabFilter';
import { newEmptyTab, setTitle, setUrl } from '../Tab';

function tab(title: string, url: string): Tab {
  return setUrl(url, setTitle(title, newEmptyTab()));
}

const github = tab('GitHub issues', 'https://github.com/yuli/tabverse/issues');
const issues = tab(
  'Issues · yuli/tabverse',
  'https://github.com/yuli/tabverse',
);
const docs = tab('Read the docs', 'https://example.com/docs/intro');
const blank = tab('', 'chrome://extensions');

const all: Tab[] = [github, issues, docs, blank];

const titles = (tabs: Tab[]): string[] => tabs.map((each) => each.title);

test('the text is split into lowercased terms', () => {
  expect(activeTabFilterTerms('  Foo   BAR ')).toEqual(['foo', 'bar']);
  expect(activeTabFilterTerms('   ')).toEqual([]);
});

test('a box with nothing in it is not filtering', () => {
  expect(isActiveTabFilterActive('  ')).toBe(false);
  expect(isActiveTabFilterActive('x')).toBe(true);
});

test('an empty box returns the whole list, in the order it came in', () => {
  expect(filterActiveTabs(all, '   ')).toEqual(all);
  expect(matchActiveTabs(all, '').every((match) => match.score === 0)).toBe(
    true,
  );
});

test('a term is a substring test, case insensitive, in title or url', () => {
  expect(titles(filterActiveTabs(all, 'GITHUB'))).toEqual([
    'GitHub issues',
    'Issues · yuli/tabverse',
  ]);
  // inside a word, like the rest of the search (data/search/searchable.ts)
  expect(titles(filterActiveTabs(all, 'doc'))).toEqual(['Read the docs']);
  // and a term that is only in the url still finds the tab
  expect(titles(filterActiveTabs(all, 'example.com'))).toEqual([
    'Read the docs',
  ]);
});

test('every term has to be somewhere in the tab', () => {
  expect(titles(filterActiveTabs(all, 'github issues'))).toEqual([
    'GitHub issues',
    'Issues · yuli/tabverse',
  ]);
  expect(filterActiveTabs(all, 'github nothing')).toEqual([]);
});

test('a term may come from the title and another from the url', () => {
  const row = tab('Pull request', 'https://github.com/yuli/tabverse/pull/3');
  expect(titles(filterActiveTabs([row, docs], 'github pull'))).toEqual([
    'Pull request',
  ]);
});

test('a title hit outranks a url hit', () => {
  // 'tabverse' is in the second tab's title and only in the first's url
  expect(titles(filterActiveTabs(all, 'tabverse'))).toEqual([
    'Issues · yuli/tabverse',
    'GitHub issues',
  ]);
  expect(matchActiveTabs(all, 'tabverse')[0].field).toBe('title');
  expect(matchActiveTabs(all, 'tabverse')[1].field).toBe('url');
});

test('more of the query in the title wins', () => {
  const rows = [
    tab('Reference', 'https://example.com/docs'),
    tab('The docs index', 'https://other.test/'),
  ];
  expect(titles(filterActiveTabs(rows, 'docs'))[0]).toBe('The docs index');
});

test('the terms next to each other in one title beat them scattered', () => {
  const rows = [
    tab('docs for the tabverse', 'https://example.com/'),
    tab('tabverse docs', 'https://example.com/'),
  ];
  // the phrase bonus: "tabverse docs" is what the user typed
  expect(titles(filterActiveTabs(rows, 'tabverse docs'))[0]).toBe(
    'tabverse docs',
  );
});

test('an earlier hit beats a later one at the same score', () => {
  const rows = [
    tab('alpha then beta', 'https://example.com/'),
    tab('beta then alpha', 'https://example.com/'),
  ];
  expect(titles(filterActiveTabs(rows, 'alpha'))[0]).toBe('alpha then beta');
});

test('ties keep the tabverse order, so the list does not shuffle', () => {
  const rows = [
    tab('one', 'https://a.test/one'),
    tab('two', 'https://b.test/two'),
    tab('three', 'https://c.test/three'),
  ];
  expect(titles(filterActiveTabs(rows, 'test'))).toEqual([
    'one',
    'two',
    'three',
  ]);
  // a term in a url only: the same order, the same rows
  expect(titles(filterActiveTabs(rows, 'b.test'))).toEqual(['two']);
});

test('a tab with no title and no url is simply not a match', () => {
  expect(filterActiveTabs([tab('', '')], 'anything')).toEqual([]);
});
