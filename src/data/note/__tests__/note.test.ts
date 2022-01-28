import { AllNote, Note } from '../Note';

import { isIdNotSaved } from '../../common';

function initAllNote() {
  const tabSpaceId = 'hello';
  const allNote = new AllNote(tabSpaceId);
  const n1 = new Note();
  n1.name = 'Note 1';
  const n2 = new Note();
  n2.name = 'Note 2';
  allNote.addNote(n1);
  allNote.addNote(n2);
  return { tabSpaceId, allNote, n1, n2 };
}

test('init', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  expect(allNote.notes.size).toEqual(2);
  expect(allNote.tabSpaceId).toEqual(tabSpaceId);
  expect(n1.tabSpaceId).toEqual(tabSpaceId);
  expect(n2.tabSpaceId).toEqual(tabSpaceId);
  expect(allNote.findNoteIndex(n2.id)).toEqual(1);
});

test('updateNote', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  const n3 = Note.fromJSON(n2.toJSON());
  n3.name = n2.name + 'changed';
  expect(allNote.updateNote('888', n3)).toBeNull();
  allNote.updateNote(n2.id, n3);
  const i = allNote.findNoteIndex(n2.id);
  expect(allNote.notes.get(i).name).toEqual(n3.name);
});

test('removeNote', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  allNote.removeNote('888');
  expect(allNote.notes.size).toEqual(2);
  allNote.removeNote(n2.id);
  expect(allNote.notes.size).toEqual(1);
});

test('updateTabSpaceId', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  const newTabSpaceId = tabSpaceId + 'changed';
  allNote.updateTabSpaceId(newTabSpaceId);
  expect(allNote.tabSpaceId).toEqual(newTabSpaceId);
  expect(allNote.notes.map((note) => note.tabSpaceId).toArray()).toEqual([
    newTabSpaceId,
    newTabSpaceId,
  ]);
});

test('note isEqualContent', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  expect(n1.isEqualContent(n2)).toBeFalsy();
  expect(n1.isEqualContent(n2, true)).toBeFalsy();
  expect(n1.isEqualContent(undefined)).toBeFalsy();
  const n3 = n1.clone();
  expect(n1.isEqualContent(n3)).toBeTruthy();
  expect(n1.isEqualContent(n3, true)).toBeTruthy();
});

test('misc', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  const {
    allNoteSavePayload,
    isNewAllNote,
    newNoteSavePayloads,
    existNoteSavePayloads,
  } = allNote.convertAndGetSavePayload();
  allNoteSavePayload.noteIds.forEach((noteId) => {
    expect(isIdNotSaved(noteId)).toBeFalsy();
  });
  expect(isNewAllNote).toBeTruthy();
  expect(allNoteSavePayload.noteIds).toEqual(
    newNoteSavePayloads.map((noteSavePayload) => noteSavePayload.id),
  );
  expect(existNoteSavePayloads.length).toEqual(0);
});
