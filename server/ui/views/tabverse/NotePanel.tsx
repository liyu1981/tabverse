import { Card } from '@blueprintjs/core';
import React from 'react';

import { markdownToPlainText } from '../../../../src/data/note/markdownText';
import noteClasses from '../../../../src/ui/notebook/Note.module.scss';
import notebookClasses from '../../../../src/ui/notebook/NotebookView.module.scss';
import type { Note } from '../../data/tabverseAdapter';
import classes from './tabverse.module.scss';

/**
 * The extension's notebook, read.
 *
 * A note there is a title bar with a caret and a rich-text editor under it, both
 * inside the notebook's own white panel. The caret collapses the editor and the
 * editor is an editor - so this shows the title in the extension's type and the
 * body as text: `note.data` is Markdown written on another machine, and a page
 * holding that person's account has no business putting its markup in its own
 * document (see `data/note/markdownText.ts`).
 *
 * Each note is a card, which is what it looked like in the extension too - there
 * the white notebook panel supplied the surface, and here every other thing in
 * this pane brings its own, so a note that brought none was floating text on the
 * pane's grey. The title row is the extension's *type*, not its 50px row: that
 * row was tall because a caret and a delete button sat in it, and neither has
 * anywhere to go here.
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
        <Card key={note.id} className={classes.noteCard}>
          <div className={noteClasses.titleContainer}>
            <b>{note.name || '(untitled)'}</b>
          </div>
          <div className={classes.noteBody}>{bodyOf(note)}</div>
        </Card>
      ))}
    </div>
  );
}

function bodyOf(note: Note): React.ReactNode {
  const text = markdownToPlainText(note.data);
  if (!text) return <span className={classes.noteEmpty}>(empty)</span>;
  return <pre className={classes.noteText}>{text}</pre>;
}
