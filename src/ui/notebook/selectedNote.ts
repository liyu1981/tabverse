import { createEvent, createStore } from 'effector';

import type { RichTextEditorHandle } from './RichTextEditor';

/**
 * The note the person is working in.
 *
 * It is a **selection**, not a focus: the note stays selected when the editor
 * blurs, which is what clicking the tab list to summarize does. An action
 * outside the notebook - "append to current note" - needs to know where
 * "current" is even then. Picking another note moves the selection.
 */
export const $selectedNoteId = createStore<string | null>(null);
export const selectNote = createEvent<string>();
/** The selected note's editor is gone (folded or removed): nothing to append to. */
export const clearNoteSelection = createEvent();
$selectedNoteId
  .on(selectNote, (_, id) => id)
  .on(clearNoteSelection, () => null);

/**
 * The editor handle per note, so a caller outside the note can read and
 * propose into it. A plain map, not a store: nothing renders from a handle,
 * and the selection store is what makes the UI react. A note that unmounts
 * unregisters, and `getNoteEditor` on a gone id is null rather than a stale
 * handle.
 */
const editors = new Map<string, RichTextEditorHandle>();

export function registerNoteEditor(
  id: string,
  handle: RichTextEditorHandle,
): void {
  editors.set(id, handle);
}

export function unregisterNoteEditor(id: string): void {
  editors.delete(id);
}

/** The mounted editor for a note id (or null), if there is one. */
export function getNoteEditor(id: string | null): RichTextEditorHandle | null {
  return id === null ? null : (editors.get(id) ?? null);
}
