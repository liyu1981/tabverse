import React from 'react';

import { normalizeNoteHtml } from '../../../../src/ui/notebook/draftLegacy';
import noteClasses from '../../../../src/ui/notebook/Note.module.scss';
import notebookClasses from '../../../../src/ui/notebook/NotebookView.module.scss';
import { htmlToPlainText } from '../../data/noteText';
import type { Note } from '../../data/tabverseAdapter';
import classes from './tabverse.module.scss';

/**
 * The extension's notebook, read.
 *
 * A note there is a title bar with a caret and a rich-text editor under it. The
 * caret collapses the editor, and the editor is an editor - so this shows the
 * title the same way and the body as text: `note.data` is HTML written on
 * another machine, and a page holding that person's account has no business
 * putting it in its own document (see `data/noteText.ts`). The legacy draft-js
 * format goes through the extension's own `normalizeNoteHtml` first, so an old
 * note is not a wall of JSON here either.
 */
export function NotePanel(props: { notes: Note[] }) {
  if (!props.notes.length) {
    return (
      <div className={notebookClasses.noticeContainer}>
        No notes stored with this tabverse.
      </div>
    );
  }

  return (
    <div className={notebookClasses.container}>
      {props.notes.map((note) => (
        <div key={note.id}>
          <div className={noteClasses.container}>
            <div className={noteClasses.titleContainer}>
              <b>{note.name || '(untitled)'}</b>
            </div>
          </div>
          <div className={classes.noteBody}>{bodyOf(note)}</div>
        </div>
      ))}
    </div>
  );
}

function bodyOf(note: Note): React.ReactNode {
  const text = htmlToPlainText(normalizeNoteHtml(note.data));
  if (!text) return <span className={classes.noteEmpty}>(empty)</span>;
  return <pre className={classes.noteText}>{text}</pre>;
}
