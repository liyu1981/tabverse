import { t } from '../../i18n';
import { $allNote, noteStoreApi } from '../../data/note/store';
import React, { useMemo, useState } from 'react';
import { Note, newEmptyNote, setName } from '../../data/note/Note';
import { saveCurrentNotes } from '../../data/note/util';

import { Button, Icon, Tooltip } from '@blueprintjs/core';
import clsx from 'clsx';
import { useStore } from 'effector-react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { ListFilter } from '../common/ListFilter';
import { NoteView } from './Note';
import classes from './NotebookView.module.scss';
import { filterByText, markdownToText } from '../../data/search/inMemorySearch';
import {
  $notebookTabs,
  noteTabActivated,
  noteTabClosed,
  noteTabDropped,
  noteTabOpened,
} from './notebookTabs';

function formatTimestamp(ms: number): string {
  if (ms < 0) {
    return '—';
  }
  return new Date(ms).toLocaleString();
}

export function NotebookView() {
  const allNote = useStore($allNote);
  const [filterText, setFilterText] = useState('');
  // The tab strip outlives this component: pinning the tool remounts it, and
  // the open notes are kept (notebookTabs.ts).
  const { openNoteIds, activeTab } = useStore($notebookTabs);

  const updateNote = (nid: string, changes: Partial<Note>) => {
    noteStoreApi.updateNote({ nid, changes });
    saveCurrentNotes();
  };

  const removeNote = (nid: string) => {
    noteStoreApi.removeNote(nid);
    saveCurrentNotes();
    noteTabDropped(nid);
  };

  const newNote = () => {
    const note = setName(`Note ${Date.now()}`, newEmptyNote());
    noteStoreApi.addNote(note);
    saveCurrentNotes();
    noteTabOpened(note.id);
  };

  const allNotes = allNote.notes.reverse().toArray();
  // in memory, not a query: the list is already here (data/search/inMemorySearch)
  const currentNotes = filterByText(
    allNotes,
    (note) => `${note.name} ${markdownToText(note.data)}`,
    filterText,
  );

  // A note tab whose note is gone (removed elsewhere) simply drops out.
  const openNotes = useMemo(
    () =>
      openNoteIds
        .map((id) => allNote.notes.find((note) => note.id === id))
        .filter((note): note is Note => note !== undefined),
    [openNoteIds, allNote.notes],
  );

  const activeNote = openNotes.find((note) => note.id === activeTab) ?? null;
  const showingIndex = activeNote === null;

  return (
    <ErrorBoundary>
      <div className={classes.container}>
        <div className={classes.tabBar}>
          <div className={classes.tabs}>
            <button
              type="button"
              className={clsx(
                classes.tab,
                classes.indexTab,
                showingIndex ? classes.tabActive : '',
              )}
              onClick={() => noteTabActivated(null)}
            >
              <Icon icon="properties" size={12} />
              <span className={classes.tabLabel}>All Notes</span>
            </button>
            {openNotes.map((note) => (
              <div
                key={note.id}
                className={clsx(
                  classes.tab,
                  note.id === activeTab ? classes.tabActive : '',
                )}
              >
                <Tooltip content={note.name} placement="bottom" compact={true}>
                  <button
                    type="button"
                    className={classes.tabLabelButton}
                    onClick={() => noteTabActivated(note.id)}
                  >
                    <span className={classes.tabLabel}>{note.name}</span>
                  </button>
                </Tooltip>
                <button
                  type="button"
                  className={classes.tabClose}
                  aria-label="Close note"
                  onClick={() => noteTabClosed(note.id)}
                >
                  <Icon icon="cross" size={10} />
                </button>
              </div>
            ))}
          </div>
          <Button
            className={classes.newNoteButton}
            icon="plus"
            minimal={true}
            onClick={newNote}
          >
            New Note
          </Button>
        </div>

        {showingIndex ? (
          <div className={classes.indexPanel}>
            <div className={classes.filterContainer}>
              <ListFilter
                value={filterText}
                onChange={setFilterText}
                placeholder={t('noteFilterPlaceholder')}
                count={currentNotes.length}
                total={allNotes.length}
                ariaLabel={t('noteFilterAria')}
              />
            </div>
            <div className={classes.noteList}>
              {allNotes.length <= 0 ? (
                <div className={classes.noticeContainer}>
                  No notes found! You can create new note with New Note button.
                </div>
              ) : currentNotes.length <= 0 ? (
                <div className={classes.noticeContainer}>
                  No note matches the filter.
                </div>
              ) : (
                currentNotes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={classes.noteListItem}
                    onClick={() => noteTabOpened(note.id)}
                  >
                    <span className={classes.noteListName}>{note.name}</span>
                    <span className={classes.noteListMeta}>
                      <span>created {formatTimestamp(note.createdAt)}</span>
                      <span>updated {formatTimestamp(note.updatedAt)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className={classes.notePanel}>
            <NoteView
              key={activeNote.id}
              note={activeNote}
              removeFunc={removeNote}
              updateFunc={updateNote}
            />
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
