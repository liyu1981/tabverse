import { bootstrap, getAllNoteData, loadByTabSpaceId } from '../bootstrap';
import {
  getTabSpaceData,
  bootstrap as tabSpaceBootstrap,
} from '../../tabSpace/bootstrap';
import { queryAllNote, saveCurrentAllNote } from '../noteStore';

import { Note } from '../note';
import { initTabSpaceData } from '../../tabSpace/__tests__/tabSpaceStore.test';

async function bootstrapAllNote() {
  const { tst1 } = await initTabSpaceData();
  await tabSpaceBootstrap(tst1.id, tst1.windowId);
  const tabSpaceId = getTabSpaceData().tabSpace.id;
  bootstrap();
  await loadByTabSpaceId(tabSpaceId);
  return { tabSpaceId };
}

test('all', async () => {
  const { tabSpaceId } = await bootstrapAllNote();
  expect(getAllNoteData().allNote.notes.size).toEqual(0);
  expect(getAllNoteData().allNote.tabSpaceId).toEqual(tabSpaceId);

  const n1 = new Note();
  n1.name = 'test note1';
  n1.data = 'test note data1';
  const n2 = new Note();
  n2.name = 'test note2';
  n2.data = 'test note data2';
  getAllNoteData().allNote.addNote(n1);
  getAllNoteData().allNote.addNote(n2);
  await saveCurrentAllNote();

  const allNote2 = await queryAllNote(tabSpaceId);
  expect(allNote2.toJSON()).toEqual(getAllNoteData().allNote.toJSON());
  allNote2.notes.forEach((note) => {
    const nIndex = getAllNoteData().allNote.notes.findIndex(
      (n) => n.id === note.id,
    );
    expect(nIndex).toBeGreaterThanOrEqual(0);
    const n = getAllNoteData().allNote.notes.get(nIndex);
    expect(n.toJSON()).toEqual(note.toJSON());
  });

  const changedData = n1.data + 'changed';
  getAllNoteData().allNote.updateNote(
    getAllNoteData().allNote.notes.get(0).id,
    { data: changedData },
  );
  const changedName = (n2.name = 'changed');
  getAllNoteData().allNote.updateNote(
    getAllNoteData().allNote.notes.get(1).id,
    { name: changedName },
  );
  await saveCurrentAllNote();
  const allNote3 = await queryAllNote(tabSpaceId);
  expect(allNote3.notes.get(0).data).toEqual(changedData);
  expect(allNote3.notes.get(1).name).toEqual(changedName);
});
