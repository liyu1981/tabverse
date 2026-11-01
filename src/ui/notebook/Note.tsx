import { t } from '../../i18n';
import { Button, EditableText } from '@blueprintjs/core';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Note } from '../../data/note/Note';
import { ReviseNoteButton } from './ReviseNoteButton';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';
import {
  $selectedNoteId,
  clearNoteSelection,
  registerNoteEditor,
  selectNote,
  unregisterNoteEditor,
} from './selectedNote';
import classes from './Note.module.scss';

export interface INoteViewProps {
  note: Note;
  removeFunc: (id: string) => void;
  updateFunc: (id: string, params: Partial<Note>) => void;
}

/**
 * One note's pane: the title row (editable title, the AI actions, delete) above
 * the rich text editor.
 *
 * The pane is what a note tab shows; the notebook's tab strip is what decides
 * which pane is mounted. The note registers its editor while it is mounted, so
 * the actions outside the notebook ("append to current note") can reach it.
 */
export const NoteView = (props: INoteViewProps) => {
  const { note, updateFunc, removeFunc } = props;
  const [name, setName] = useState(note.name);
  // The editor owns the body, and `getContent()` is how it is read back as
  // markdown; note.data is markdown.
  const editorRef = useRef<RichTextEditorHandle>(null);

  // A note shown in its own tab is the note being worked on.
  useEffect(() => {
    selectNote(note.id);
  }, [note.id]);

  // A callback ref, so the handle is registered exactly while the editor is
  // mounted: switching tabs unmounts it, and a stale handle must not be handed
  // to a caller outside the notebook.
  const setEditorRef = useCallback(
    (handle: RichTextEditorHandle | null) => {
      editorRef.current = handle;
      if (handle !== null) {
        registerNoteEditor(note.id, handle);
      } else {
        unregisterNoteEditor(note.id);
        if ($selectedNoteId.getState() === note.id) {
          clearNoteSelection();
        }
      }
    },
    [note.id],
  );

  const updateCurrentNote = () => {
    updateFunc(note.id, {
      name,
      data: editorRef.current?.getContent() ?? note.data,
    });
  };

  return (
    <div className={classes.pane}>
      <div className={classes.titleRow}>
        <div className={classes.titleContainer}>
          <EditableText
            className={classes.titleText}
            alwaysRenderInput={true}
            maxLength={256}
            value={name}
            selectAllOnFocus={false}
            onChange={(value) => setName(value)}
            onConfirm={() => updateCurrentNote()}
          />
        </div>
        <div className={classes.toolsContainer}>
          <ReviseNoteButton
            noteTitle={name}
            getContent={() => editorRef.current?.getContent() ?? ''}
            proposeContent={(markdown) =>
              editorRef.current?.setContent(markdown)
            }
          />
          <Button
            icon="trash"
            minimal={true}
            aria-label={t('todoDeleteAria')}
            onClick={() => removeFunc(note.id)}
          />
        </div>
      </div>
      <div className={classes.editorContainer}>
        <RichTextEditor
          fill={true}
          ref={setEditorRef}
          markdown={note.data}
          onFocus={() => selectNote(note.id)}
          onApply={updateCurrentNote}
          onBlur={updateCurrentNote}
          placeholder={t('notePlaceholder')}
        />
      </div>
    </div>
  );
};
