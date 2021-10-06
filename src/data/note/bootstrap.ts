import { AllNote, Note } from './note';
import {
  SavedNoteStore,
  monitorAllNoteChange,
  monitorTabSpaceChanges,
  queryAllNote,
} from './noteStore';

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

export async function bootstrap(tabSpaceId: string) {
  const allNote = await queryAllNote(tabSpaceId, addPagingToQueryParams({}));
  const savedNoteStore = new SavedNoteStore();
  const latestSavedTime =
    allNote.notes.max((na: Note, nb: Note) =>
      na.updatedAt > nb.updatedAt ? 1 : na.updatedAt === nb.updatedAt ? 0 : -1,
    )?.updatedAt ?? 0;
  savedNoteStore.updateLastSavedTime(latestSavedTime);
  getSavedStoreManager().addSavedStore('note', savedNoteStore);
  allNoteData = {
    allNote,
    savedNoteStore,
  };

  monitorTabSpaceChanges(allNote);
  monitorAllNoteChange(allNote, savedNoteStore);
  exposeDebugData('note', { getAllNoteData });
}
