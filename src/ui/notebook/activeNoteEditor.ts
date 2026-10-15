import type { RichTextEditorHandle } from './RichTextEditor';

/**
 * The note editor the person is last known to be working in.
 *
 * The summarize action lives on a tab card, and the note it can add to lives in
 * the notebook panel - two different trees. When the notebook is open, the
 * summary should be *proposed into the note being edited* (with the review
 * dialog) rather than always becoming a new one, so the two need one handle to
 * talk through. Focus sets it; a note only clears it if it is still the active
 * one when it unmounts, so unmounting an old note cannot steal it from a newer
 * one.
 *
 * A single module-level slot, not a store: nothing renders from it, and it is
 * deliberately stale-tolerant (a closed notebook leaves a handle whose editor
 * is gone; `setContent` on it is a no-op).
 */
let active: RichTextEditorHandle | null = null;

export function setActiveNoteEditor(handle: RichTextEditorHandle | null): void {
  active = handle;
}

export function getActiveNoteEditor(): RichTextEditorHandle | null {
  return active;
}
