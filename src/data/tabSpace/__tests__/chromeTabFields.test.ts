/**
 * What a live chrome tab says about one of our tabs.
 *
 * The one behaviour here worth a file of its own is split view, because it is
 * the only field where chrome's silence is not the absence of an answer:
 * `SPLIT_VIEW_ID_NONE` is a value, and it is how chrome says "this tab is not in
 * a split view". Storing it as `undefined` - which is what this used to do -
 * made that the same thing as a tab nobody has looked at, and then a closed
 * split could never retire the pairing it had written (ADR 0022).
 *
 * `discarded` is the other field Chrome always answers, and it goes both ways:
 * a tab that was suspended and has since been reloaded must read as loaded
 * again (the summarize action is disabled while it is suspended), so it is
 * copied even when false - unlike title/url, whose silence while a tab is
 * unloaded must not blank a kept tab's saved fields.
 */
import { copyChromeTabFields } from '../chromeTabFields';
import { SPLIT_VIEW_ID_NONE, newEmptyTab, type Tab } from '../Tab';

const chromeTab = (over: Partial<chrome.tabs.Tab> = {}) =>
  ({
    id: 1,
    title: '',
    url: '',
    favIconUrl: '',
    pinned: false,
    discarded: false,
    ...over,
  }) as chrome.tabs.Tab;

test('the answer that means "not in a split" is kept as the answer it is', () => {
  const tab = copyChromeTabFields(
    chromeTab({ splitViewId: SPLIT_VIEW_ID_NONE }),
    newEmptyTab(),
  );
  // Not undefined. Undefined means "chrome has no opinion", and losing that
  // difference is what made a closed split indistinguishable from a stored tab.
  expect(tab.splitViewId).toBe(SPLIT_VIEW_ID_NONE);
});

test('a split view id is kept', () => {
  expect(
    copyChromeTabFields(chromeTab({ splitViewId: 7 }), newEmptyTab())
      .splitViewId,
  ).toBe(7);
});

test('a browser with no split view support says nothing, and nothing is written', () => {
  // Chrome before 140 has no splitViewId on a tab at all. The field is then left
  // as it was, which is the only reading that keeps a stored pairing intact.
  const stored = { ...newEmptyTab(), splitWith: 't2' };
  const tab = copyChromeTabFields(chromeTab(), stored);
  expect(tab.splitViewId).toBeUndefined();
  expect(tab.splitWith).toBe('t2');
});

test('chrome clearing the split says so, on a tab that was split', () => {
  const wasSplit = { ...newEmptyTab(), splitViewId: 7 };
  const tab = copyChromeTabFields(
    chromeTab({ splitViewId: SPLIT_VIEW_ID_NONE }),
    wasSplit,
  );
  expect(tab.splitViewId).toBe(SPLIT_VIEW_ID_NONE);
});

test('a discarded tab reads as suspended', () => {
  const tab = copyChromeTabFields(
    chromeTab({ discarded: true }),
    newEmptyTab(),
  );
  expect(tab.suspended).toBe(true);
});

test('a reloaded tab reads as not suspended again', () => {
  const suspended: Tab = { ...newEmptyTab(), suspended: true };
  const tab = copyChromeTabFields(chromeTab({ discarded: false }), suspended);
  expect(tab.suspended).toBe(false);
});

test('title and url are not blanked by an unloaded tab', () => {
  const existing: Tab = {
    ...newEmptyTab(),
    title: 'Kept',
    url: 'https://kept.example/',
  };
  const tab = copyChromeTabFields(
    chromeTab({ discarded: true, title: '', url: '' }),
    existing,
  );
  expect(tab.title).toBe('Kept');
  expect(tab.url).toBe('https://kept.example/');
});
