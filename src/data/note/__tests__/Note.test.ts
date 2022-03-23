/* eslint-disable prefer-const */
import { cloneNote, isEqualContent, newEmptyNote, setName } from '../Note';

import { isIdNotSaved } from '../../common';
import {
  addNote,
  convertAndGetAllNoteSavePayload,
  newEmptyAllNote,
  removeNote,
  updateNote,
  updateTabSpaceId,
} from '../AllNote';

function initAllNote() {
  const tabSpaceId = 'hello';
  let allNote = updateTabSpaceId(tabSpaceId, newEmptyAllNote());
  allNote = addNote(setName('Note 1', newEmptyNote()), allNote);
  allNote = addNote(setName('Note 2', newEmptyNote()), allNote);
  const [n1, n2] = allNote.notes.toArray();
  return { tabSpaceId, allNote, n1, n2 };
}

test('init', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  expect(allNote.notes.size).toEqual(2);
  expect(allNote.tabSpaceId).toEqual(tabSpaceId);
  expect(allNote.notes.map((note) => note.tabSpaceId).toArray()).toEqual([
    tabSpaceId,
    tabSpaceId,
  ]);
});

test('updateNote', () => {
  let { tabSpaceId, allNote, n1, n2 } = initAllNote();
  const changedName = n2.name + 'changed';
  allNote = updateNote('888', { name: changedName }, allNote);
  expect(allNote.notes.toArray()).toEqual([n1, n2]);
  allNote = updateNote(n2.id, { name: changedName }, allNote);
  expect(allNote.notes.get(1).name).toEqual(changedName);
});

test('removeNote', () => {
  let { tabSpaceId, allNote, n1, n2 } = initAllNote();
  allNote = removeNote('888', allNote);
  expect(allNote.notes.size).toEqual(2);
  allNote = removeNote(n2.id, allNote);
  expect(allNote.notes.size).toEqual(1);
});

test('updateTabSpaceId', () => {
  let { tabSpaceId, allNote, n1, n2 } = initAllNote();
  const newTabSpaceId = tabSpaceId + 'changed';
  allNote = updateTabSpaceId(newTabSpaceId, allNote);
  expect(allNote.tabSpaceId).toEqual(newTabSpaceId);
  expect(allNote.notes.map((note) => note.tabSpaceId).toArray()).toEqual([
    newTabSpaceId,
    newTabSpaceId,
  ]);
});

test('note isEqualContent', () => {
  const { tabSpaceId, allNote, n1, n2 } = initAllNote();
  expect(isEqualContent(n1, n2)).toBeFalsy();
  expect(isEqualContent(n1, n2, true)).toBeFalsy();
  expect(isEqualContent(n1, undefined)).toBeFalsy();
  const n3 = cloneNote(n1);
  expect(isEqualContent(n1, n3)).toBeTruthy();
  expect(isEqualContent(n1, n3, true)).toBeTruthy();
});

test('misc', () => {
  let { tabSpaceId, allNote, n1, n2 } = initAllNote();
  const {
    allNote: savedAllNote,
    allNoteSavePayload,
    isNewAllNote,
    newNoteSavePayloads,
    existNoteSavePayloads,
  } = convertAndGetAllNoteSavePayload(allNote);
  expect(isIdNotSaved(savedAllNote.tabSpaceId)).toBeFalsy();
  expect(savedAllNote.notes.toArray()).toEqual(newNoteSavePayloads);
  allNoteSavePayload.noteIds.forEach((noteId) => {
    expect(isIdNotSaved(noteId)).toBeFalsy();
  });
  expect(isNewAllNote).toBeTruthy();
  expect(allNoteSavePayload.noteIds).toEqual(
    newNoteSavePayloads.map((noteSavePayload) => noteSavePayload.id),
  );
  expect(existNoteSavePayloads.length).toEqual(0);
});
