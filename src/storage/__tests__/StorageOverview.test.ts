import {
  $storageOverview,
  StorageOverview,
  storageOverviewApi,
} from '../StorageOverview';
import { markInSaving, newEmptyGeneralStorage } from '../GeneralStorage';

// the overview is module state; each test states only what it cares about
beforeEach(() => {
  storageOverviewApi.update(new StorageOverview({}));
});

const storageOf = (key: string) => $storageOverview.getState().storages[key];

/**
 * The keys are the names SaveIndicator prints per row, and one tool writing
 * under another's key made three of them share a single row: whichever saved
 * last decided what the indicator said about all of them.
 */
test('each right side tool keeps its own row', () => {
  storageOverviewApi.updateNoteStorage({
    ...newEmptyGeneralStorage(),
    lastSavedTime: 1000,
  });
  storageOverviewApi.updateTodoStorage({
    ...newEmptyGeneralStorage(),
    lastSavedTime: 2000,
  });
  storageOverviewApi.updateBookmarkStorage({
    ...newEmptyGeneralStorage(),
    lastSavedTime: 3000,
  });

  expect(storageOf('note').lastSavedTime).toEqual(1000);
  expect(storageOf('todo').lastSavedTime).toEqual(2000);
  expect(storageOf('bookmark').lastSavedTime).toEqual(3000);
  expect(Object.keys($storageOverview.getState().storages).sort()).toEqual([
    'bookmark',
    'note',
    'todo',
  ]);
});

test('a saving tool is reported as saving, and the newest save is the latest', () => {
  storageOverviewApi.updateNoteStorage(newEmptyGeneralStorage());
  storageOverviewApi.updateTodoStorage(
    markInSaving(true, newEmptyGeneralStorage()),
  );

  const [anyInSaving, who] = $storageOverview.getState().anyStorageInSaving();
  expect(anyInSaving).toBe(true);
  expect(who).toEqual(['todo']);

  storageOverviewApi.updateTodoStorage({
    ...newEmptyGeneralStorage(),
    lastSavedTime: 4242,
  });
  expect($storageOverview.getState().anyStorageInSaving()[0]).toBe(false);
  expect($storageOverview.getState().getLastSavedStorage().lastSavedTime).toBe(
    4242,
  );
});

test('getAllLastSavedTime reports one row per tool, for the tooltip', () => {
  storageOverviewApi.updateNoteStorage({
    ...newEmptyGeneralStorage(),
    lastSavedTime: 7,
  });
  storageOverviewApi.updateClosedTabStorage({
    ...newEmptyGeneralStorage(),
    lastSavedTime: 8,
  });
  expect($storageOverview.getState().getAllLastSavedTime()).toEqual([
    ['note', 7],
    ['closedTab', 8],
  ]);
});
