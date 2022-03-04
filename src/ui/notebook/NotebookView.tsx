import { INote, Note } from '../../data/note/Note';
import React, { useMemo } from 'react';

import { AllNoteData } from '../../data/note/bootstrap';
import { Button } from '@blueprintjs/core';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { NoteView } from './Note';
import classes from './NotebookView.module.scss';
import { observer } from 'mobx-react-lite';

export interface NotebookViewProps {
  allNoteData: AllNoteData;
}

export const NotebookView = observer((props: NotebookViewProps) => {
  const updateNote = useMemo(
    () => (id: string, params: Partial<INote>) => {
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
    },
    [],
  );

  const removeNote = useMemo(
    () => (id: string) => {
      props.allNoteData.allNote.removeNote(id);
    },
    [],
  );

  const currentNotes = props.allNoteData.allNote.notes.reverse().toArray();

  const renderNotes = () => {
    return currentNotes.map((note) => (
      <NoteView
        key={note.id}
        note={note}
        removeFunc={removeNote}
        updateFunc={updateNote}
      />
    ));
  };

  return (
    <ErrorBoundary>
      <div className={classes.container}>
        {currentNotes.length <= 0 ? (
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
        </div>
        {renderNotes()}
      </div>
    </ErrorBoundary>
  );
});
