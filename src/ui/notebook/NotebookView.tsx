import { $allNote, noteStoreApi } from '../../data/note/store';
import React, { useState } from 'react';
import { Note, newEmptyNote, setName } from '../../data/note/Note';
import { saveCurrentNotes } from '../../data/note/util';

import { Button } from '@blueprintjs/core';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ListFilter } from '../common/ListFilter';
import { NoteView } from './Note';
import classes from './NotebookView.module.scss';
import { filterByText, htmlToText } from '../../data/search/inMemorySearch';
import { useStore } from 'effector-react';

export function NotebookView() {
  const allNote = useStore($allNote);
  const [filterText, setFilterText] = useState('');

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

  const allNotes = allNote.notes.reverse().toArray();
  // in memory, not a query: the list is already here (data/search/inMemorySearch)
  const currentNotes = filterByText(
    allNotes,
    (note) => `${note.name} ${htmlToText(note.data)}`,
    filterText,
  );

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
        {allNotes.length <= 0 ? (
          <div className={classes.noticeContainer}>
            No notes found! You can create new note with New Note button.
          </div>
        ) : currentNotes.length <= 0 ? (
          <div className={classes.noticeContainer}>
            No note matches the filter.
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
          <div className={classes.filterContainer}>
            <ListFilter
              value={filterText}
              onChange={setFilterText}
              placeholder="filter these notes…"
              count={currentNotes.length}
              total={allNotes.length}
              ariaLabel="Filter these notes"
            />
          </div>
        </div>
        {renderNotes()}
      </div>
    </ErrorBoundary>
  );
}
