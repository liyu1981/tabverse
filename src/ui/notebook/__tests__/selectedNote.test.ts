import { expect, test } from 'vitest';

import {
  $selectedNoteId,
  clearNoteSelection,
  getNoteEditor,
  registerNoteEditor,
  selectNote,
  unregisterNoteEditor,
} from '../selectedNote';
import type { RichTextEditorHandle } from '../RichTextEditor';

test('selecting a note remembers it, and picking another moves it', () => {
  clearNoteSelection();
  expect($selectedNoteId.getState()).toBeNull();
  selectNote('n1');
  expect($selectedNoteId.getState()).toBe('n1');
  selectNote('n2');
  expect($selectedNoteId.getState()).toBe('n2');
  clearNoteSelection();
  expect($selectedNoteId.getState()).toBeNull();
});

test('the editor handle is registered per note, and gone when unregistered', () => {
  const handle = {
    getContent: () => '',
    setContent: () => undefined,
    openReview: () => undefined,
  } as RichTextEditorHandle;
  expect(getNoteEditor('n1')).toBeNull();
  expect(getNoteEditor(null)).toBeNull();
  registerNoteEditor('n1', handle);
  expect(getNoteEditor('n1')).toBe(handle);
  unregisterNoteEditor('n1');
  expect(getNoteEditor('n1')).toBeNull();
});
