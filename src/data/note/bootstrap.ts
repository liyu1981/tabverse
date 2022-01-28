import { AllNote, Note } from './Note';
import {
  SavedNoteStore,
  monitorAllNoteChange,
  monitorTabSpaceChanges,
  queryAllNote,
} from './SavedNoteStore';

import { NotTabSpaceId } from '../chromeSession/ChromeSession';
import { addPagingToQueryParams } from '../../store/store';
import { strict as assert } from 'assert';
import { exposeDebugData } from '../../debug';
import { getSavedStoreManager } from '../../store/bootstrap';

export interface AllNoteData {
  allNote: Readonly<AllNote>;
  savedNoteStore: Readonly<SavedNoteStore>;
}

let allNoteData: AllNoteData | null = null;

export function getAllNoteData(): AllNoteData {
  assert(allNoteData !== null, 'call bootstrap to init allNoteData!');
  return allNoteData;
}

export function bootstrap() {
  allNoteData = {
    allNote: new AllNote(NotTabSpaceId),
    savedNoteStore: new SavedNoteStore(),
  };

  getSavedStoreManager().addSavedStore('note', allNoteData.savedNoteStore);

  exposeDebugData('note', { getAllNoteData });
}

export async function loadByTabSpaceId(tabSpaceId: string) {
  const { allNote, savedNoteStore } = getAllNoteData();

  const loadedAllNote = await queryAllNote(
    tabSpaceId,
    addPagingToQueryParams({}),
  );
  allNote.copy(loadedAllNote);

  const latestSavedTime =
    allNote.notes.max((na: Note, nb: Note) =>
      na.updatedAt > nb.updatedAt ? 1 : na.updatedAt === nb.updatedAt ? 0 : -1,
    )?.updatedAt ?? 0;
  savedNoteStore.updateLastSavedTime(latestSavedTime);

  monitorTabSpaceChanges(allNote);
  monitorAllNoteChange(allNote, savedNoteStore);
}
