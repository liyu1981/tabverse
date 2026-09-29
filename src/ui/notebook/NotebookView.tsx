import { $allNote, noteStoreApi } from '../../data/note/store';
import { Note, newEmptyNote, setName } from '../../data/note/Note';
import React, { useEffect } from 'react';
import { monitorTabSpaceChanges, saveCurrentNotes } from '../../data/note/util';

import { Button } from '@blueprintjs/core';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { NoteView } from './Note';
import classes from './NotebookView.module.scss';
import { logger } from '../../global';
import { useStore } from 'effector-react';

export function NotebookView() {
  const allNote = useStore($allNote);

  useEffect(() => {
    logger.info('notebook start monitor tabspace, alltodo changes');
    monitorTabSpaceChanges();
  }, []);

  const updateNote = (nid: string, changes: Partial<Note>) => {
    noteStoreApi.updateNote({ nid, changes });
    saveCurrentNotes();
  };

  const removeNote = (nid: string) => {
    noteStoreApi.removeNote(nid);
    saveCurrentNotes();
  };

  const newNote = () => {
    noteStoreApi.addNote(setName(`Note ${Date.now()}`, newEmptyNote()));
    saveCurrentNotes();
  };

  const currentNotes = allNote.notes.reverse().toArray();

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
            <Button icon="draw" minimal={true} onClick={newNote}>
              New Note
            </Button>
          </div>
        </div>
        {renderNotes()}
      </div>
    </ErrorBoundary>
  );
}
