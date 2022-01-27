import * as React from 'react';

import { INote, Note } from '../../data/note/Noote';

import { AllNoteData } from '../../data/note/bootstrap';
import { Button } from '@blueprintjs/core';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { NoteView } from './Note';
import { observer } from 'mobx-react-lite';
import { usePageControl } from '../common/usePageControl';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      paddingLeft: '4px',
    },
    noteToolContainer: {
      display: 'flex',
      alignItems: 'center',
      height: '50px',
      justifyContent: 'space-between',
    },
    collapseButton: {
      width: '32px',
    },
    titleContainer: {
      width: '100%',
      fontSize: '1.5em',
    },
    toolsContainer: {
      minWidth: '50px',
      direction: 'rtl',
      textAlign: 'start',
    },
    noticeContainer: {
      background: '#fff',
      border: '1px solid #ddd',
      color: '#999',
      padding: '8px 18px',
      fontStyle: 'italic',
      fontWeight: 500,
    },
  };
}

export interface NotebookViewProps {
  allNoteData: AllNoteData;
}

const NOTE_PAGE_LIMIT = 2;

export const NotebookView = observer((props: NotebookViewProps) => {
  const styles = createStyles();

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
      <div style={styles.container}>
        {getCurrentPageNotes().length <= 0 ? (
          <div style={styles.noticeContainer}>
            No notes found! You can create new note with New Note button.
          </div>
        ) : (
          ''
        )}
        <div style={styles.noteToolContainer}>
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
