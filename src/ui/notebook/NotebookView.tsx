import * as React from 'react';

import { INote, Note } from '../../data/note/Note';

import { AllNoteData } from '../../data/note/bootstrap';
import { Button } from '@blueprintjs/core';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { NoteView } from './Note';
import { observer } from 'mobx-react-lite';
import { usePageControl } from '../common/usePageControl';
import classes from './NotebookView.module.scss';

export interface NotebookViewProps {
  allNoteData: AllNoteData;
}

const NOTE_PAGE_LIMIT = 2;

export const NotebookView = observer((props: NotebookViewProps) => {
  const updateNote = (id: string, params: Partial<INote>) => {
    const nIndex = props.allNoteData.allNote.findNoteIndex(id);
    if (nIndex < 0) {
      return;
    }
    const oldNote = props.allNoteData.allNote.notes.get(nIndex);
    const n = oldNote.clone();
    let changed = false;
    if ('name' in params) {
      n.name = params.name;
      changed = true;
    }
    if ('data' in params) {
      n.data = params.data;
      changed = true;
    }
    if (changed) {
      props.allNoteData.allNote.updateNote(n.id, n);
    }
  };

  const [getCurrentPageNotes, renderPageControl] = usePageControl(
    props.allNoteData.allNote.notes.reverse().toArray(),
    NOTE_PAGE_LIMIT,
  );

  const renderNotes = () => {
    return getCurrentPageNotes().map((note) => (
      <NoteView
        key={note.id}
        note={note}
        removeFunc={() => props.allNoteData.allNote.removeNote(note.id)}
        updateFunc={updateNote}
      />
    ));
  };

  return (
    <ErrorBoundary>
      <div className={classes.container}>
        {getCurrentPageNotes().length <= 0 ? (
          <div className={classes.noticeContainer}>
            No notes found! You can create new note with New Note button.
          </div>
        ) : (
          ''
        )}
        <div className={classes.noteToolContainer}>
          <div>
            <Button
              icon="draw"
              minimal={true}
              onClick={() => {
                props.allNoteData.allNote.addNote(new Note());
              }}
            >
              New Note
            </Button>
          </div>
          <div>
            <span>{renderPageControl()}</span>
          </div>
        </div>
        {renderNotes()}
      </div>
    </ErrorBoundary>
  );
});
