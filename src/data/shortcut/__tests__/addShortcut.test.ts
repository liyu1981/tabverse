/**
 * The one add path, with the browser seams injected: a live tab, the icon links
 * a page would declare, and a fake logo fetch. The database is the real one
 * (fake-indexeddb, see src/dev/dbImplTest), so "already saved" and "the row was
 * written" are checked where they actually happen.
 */
import { beforeEach, expect, test } from 'vitest';

import {
  AddShortcutDeps,
  addShortcutFromPage,
  addShortcutFromTab,
} from '../addShortcut';
import { SHORTCUT_DB_TABLE_NAME, Shortcut } from '../Shortcut';
import { db } from '../../../storage/db';
import { resetTestDb } from '../../../dev/dbImplTest';
import { saveShortcut } from '../util';

const ICON = 'data:image/png;base64,AAA';

function deps(overrides: Partial<AddShortcutDeps> = {}): AddShortcutDeps {
  return {
    getTab: async () => ({
      id: 7,
      title: 'Figma - a file',
      url: 'https://www.figma.com/file/1#layer',
      favIconUrl: 'https://static.figma.com/favicon.ico',
    }),
    readIconLinks: async () => [
      { href: '/icon-512.png', rel: 'icon', sizes: [512] },
      { href: '/apple-180.png', rel: 'apple-touch-icon', sizes: [180] },
    ],
    fetchIcon: async () => ICON,
    ...overrides,
  };
}

async function rows(): Promise<Shortcut[]> {
  return db.table<Shortcut>(SHORTCUT_DB_TABLE_NAME).toArray();
}

beforeEach(async () => {
  await resetTestDb();
});

test('a live tab becomes a shortcut with its title, normalized url and icon', async () => {
  const result = await addShortcutFromTab(7, deps());
  expect(result.status).toBe('created');
  expect(result.shortcut?.name).toBe('Figma - a file');
  expect(result.shortcut?.url).toBe('https://www.figma.com/file/1');
  expect(result.shortcut?.iconDataUrl).toBe(ICON);
  expect(result.shortcut?.iconUrl).toBe('https://www.figma.com/apple-180.png');
  expect(await rows()).toHaveLength(1);
});

test('adding the same page again keeps one row and says so', async () => {
  const first = await addShortcutFromTab(7, deps());
  const second = await addShortcutFromTab(7, deps());
  expect(first.status).toBe('created');
  expect(second.status).toBe('existing');
  expect(second.shortcut?.id).toBe(first.shortcut?.id);
  expect(await rows()).toHaveLength(1);
});

test('an existing row with no icon gets one, and keeps its name', async () => {
  const existing = {
    id: 'saved',
    name: 'My own name',
    url: 'https://www.figma.com/file/1',
    iconDataUrl: '',
    iconUrl: '',
    favIconUrl: '',
    createdAt: 1,
    updatedAt: 1,
    version: 12,
  };
  await saveShortcut(existing);

  const result = await addShortcutFromTab(7, deps());
  expect(result.status).toBe('existing');
  expect(result.shortcut?.name).toBe('My own name');
  expect(result.shortcut?.iconDataUrl).toBe(ICON);
  const [row] = await rows();
  expect(row?.name).toBe('My own name');
  expect(row?.iconDataUrl).toBe(ICON);
  // the fill is a write the other devices have to win the LWW race with
  expect(row?.updatedAt).toBeGreaterThan(existing.updatedAt);
});

test('a page that is not http(s) is invalid, and a dead tab unreadable', async () => {
  expect(
    (
      await addShortcutFromPage({
        name: 'settings',
        url: 'chrome://settings',
      })
    ).status,
  ).toBe('invalid');

  expect(
    (
      await addShortcutFromTab(7, {
        getTab: async () => null,
      })
    ).status,
  ).toBe('unreadable');

  expect((await addShortcutFromTab(0, deps())).status).toBe('unreadable');
});

test('a row add reuses a live tab with the same page for the logo', async () => {
  const result = await addShortcutFromPage(
    { name: 'Bookmarked', url: 'https://www.figma.com/file/1#again' },
    deps({
      findLiveTabByUrl: async () => ({
        id: 7,
        title: 'live',
        url: 'https://www.figma.com/file/1',
      }),
    }),
  );
  expect(result.status).toBe('created');
  expect(result.shortcut?.iconUrl).toBe('https://www.figma.com/apple-180.png');
});

test('an inline data icon is stored once, not in both fields', async () => {
  const inline = 'data:image/png;base64,BBB';
  const result = await addShortcutFromPage(
    { name: 'Inline', url: 'https://inline.example/' },
    deps({
      findLiveTabByUrl: async () => ({
        id: 7,
        title: '',
        url: 'https://inline.example/',
      }),
      readIconLinks: async () => [
        { href: inline, rel: 'apple-touch-icon', sizes: [180] },
      ],
      fetchIcon: async () => inline,
    }),
  );
  expect(result.shortcut?.iconDataUrl).toBe(inline);
  expect(result.shortcut?.iconUrl).toBe('');
});

test('a tab add still happens when the page cannot be scripted', async () => {
  const result = await addShortcutFromTab(
    7,
    deps({
      readIconLinks: async () => [],
      fetchIcon: async (url) =>
        url.endsWith('.ico') ? 'data:image/x-icon;base64,AAA' : '',
    }),
  );
  expect(result.status).toBe('created');
  expect(result.shortcut?.iconDataUrl).toBe('data:image/x-icon;base64,AAA');
  expect(result.shortcut?.iconUrl).toBe('https://static.figma.com/favicon.ico');
});

test('a throwing icon fetch or link read does not fail the add', async () => {
  const result = await addShortcutFromTab(
    7,
    deps({
      readIconLinks: async () => {
        throw new Error('no scripting');
      },
      fetchIcon: async () => {
        throw new Error('offline');
      },
    }),
  );
  expect(result.status).toBe('created');
  expect(result.shortcut?.iconDataUrl).toBe('');
});
