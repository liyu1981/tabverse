import { $allNote, noteStoreApi } from '../../data/note/store';
import { Note, newEmptyNote, setName } from '../../data/note/Note';
import React, { useEffect } from 'react';
import {
  monitorTabSpaceChanges,
  saveCurrentAllNoteIfNeeded,
  startMonitorLocalStorageChanges,
  stopMonitorLocalStorageChanges,
} from '../../data/note/util';

import { Button } from '@blueprintjs/core';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { NoteView } from './Note';
import classes from './NotebookView.module.scss';
import { isIdNotSaved } from '../../data/common';
import { logger } from '../../global';
import { useStore } from 'effector-react';

export interface NotebookViewProps {
  tabSpaceId: string;
}

export function NotebookView({ tabSpaceId }: NotebookViewProps) {
  const allNote = useStore($allNote);

  useEffect(() => {
    logger.info('notebook start monitor tabspace, alltodo changes');
    monitorTabSpaceChanges();
  }, []);

  useEffect(() => {
    if (tabSpaceId && isIdNotSaved(tabSpaceId)) {
      logger.info('notebook start monitor localstorage changes');
      startMonitorLocalStorageChanges();
      return () => {
        logger.info('notebook stop monitor localstorage changes');
        stopMonitorLocalStorageChanges();
      };
    }
  }, [tabSpaceId]);

  const updateNote = (nid: string, changes: Partial<Note>) => {
    noteStoreApi.updateNote({ nid, changes });
    saveCurrentAllNoteIfNeeded();
  };

  const removeNote = (nid: string) => {
    noteStoreApi.removeNote(nid);
    saveCurrentAllNoteIfNeeded();
  };

  const newNote = () => {
    noteStoreApi.addNote(setName(`Note ${Date.now()}`, newEmptyNote()));
    saveCurrentAllNoteIfNeeded();
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
