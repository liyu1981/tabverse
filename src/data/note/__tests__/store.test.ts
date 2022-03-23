import {
  getTabSpaceData,
  bootstrap as tabSpaceBootstrap,
} from '../../tabSpace/bootstrap';

import { newEmptyNote, setData, setName } from '../Note';
import { initTabSpaceData } from '../../tabSpace/__tests__/SavedTabSpaceStore.test';
import {
  loadAllNoteByTabSpaceId,
  queryAllNote,
  saveCurrentAllNote,
} from '../util';
import { $allNote, noteStoreApi } from '../store';
import { omit } from 'lodash';

async function bootstrapAllNote() {
  const { tst1 } = await initTabSpaceData();
  await tabSpaceBootstrap(tst1.id, tst1.windowId);
  const tabSpaceId = getTabSpaceData().tabSpace.id;
  await loadAllNoteByTabSpaceId(tabSpaceId);
  return { tabSpaceId };
}

test('all', async () => {
  const { tabSpaceId } = await bootstrapAllNote();
  expect($allNote.getState().notes.size).toEqual(0);
  expect($allNote.getState().tabSpaceId).toEqual(tabSpaceId);

  noteStoreApi.addNote(
    setName('test note1', setData('test note data1', newEmptyNote())),
  );
  noteStoreApi.addNote(
    setName('test note2', setData('test note data2', newEmptyNote())),
  );
  await saveCurrentAllNote();

  const allNote2 = await queryAllNote(tabSpaceId);
  expect(omit(allNote2, 'notes')).toEqual(omit($allNote.getState(), 'notes'));
  allNote2.notes.forEach((note) => {
    const nIndex = $allNote.getState().notes.findIndex((n) => n.id === note.id);
    expect(nIndex).toBeGreaterThanOrEqual(0);
    const n = $allNote.getState().notes.get(nIndex);
    expect(n).toEqual(note);
  });

  const n1 = $allNote.getState().notes.get(0);
  const n2 = $allNote.getState().notes.get(1);
  const changedData = n1.data + 'changed';
  noteStoreApi.updateNote({ nid: n1.id, changes: { data: changedData } });
  const changedName = (n2.name = 'changed');
  noteStoreApi.updateNote({ nid: n2.id, changes: { name: changedName } });
  await saveCurrentAllNote();

  const allNote3 = await queryAllNote(tabSpaceId);
  expect(allNote3.notes.get(0).data).toEqual(changedData);
  expect(allNote3.notes.get(1).name).toEqual(changedName);
});
