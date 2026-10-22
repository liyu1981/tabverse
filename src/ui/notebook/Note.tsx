import { t } from '../../i18n';
import { Button, Collapse, EditableText, Icon } from '@blueprintjs/core';
import clsx from 'clsx';
import React, { useCallback, useRef, useState } from 'react';
import { useStore } from 'effector-react';

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

export const NoteView = (props: INoteViewProps) => {
  const [name, setName] = useState(props.note.name);
  const selectedNoteId = useStore($selectedNoteId);
  const selected = selectedNoteId === props.note.id;
  // The editor owns the body, and `getContent()` is how it is read back as
  // markdown; note.data is markdown.
  const editorRef = useRef<RichTextEditorHandle>(null);
  // The fold is the note's own state, not page state, so a refresh keeps it.
  const [editorOpen, setEditorOpen] = useState(props.note.collapsed !== true);

  // A callback ref, so the handle is registered exactly while the editor is
  // mounted: collapsing the note unmounts it, and a stale handle must not be
  // handed to a caller outside the notebook.
  const setEditorRef = useCallback(
    (handle: RichTextEditorHandle | null) => {
      editorRef.current = handle;
      if (handle !== null) {
        registerNoteEditor(props.note.id, handle);
      } else {
        unregisterNoteEditor(props.note.id);
        // The editor is gone (the note folded, or was removed): if it was the
        // selected one, there is no current note to append to any more.
        if ($selectedNoteId.getState() === props.note.id) {
          clearNoteSelection();
        }
      }
    },
    [props.note.id],
  );

  const updateCurrentNote = () => {
    props.updateFunc(props.note.id, {
      name,
      data: editorRef.current?.getContent() ?? props.note.data,
    });
  };

  // A selection, not a focus: it survives the blur that clicking elsewhere on
  // the page causes, so "append to current note" still has a target.
  const selectThis = () => {
    selectNote(props.note.id);
  };

  const toggleEditor = () => {
    const next = !editorOpen;
    setEditorOpen(next);
    selectThis();
    // Save the body and remember the fold together.
    props.updateFunc(props.note.id, {
      name,
      data: editorRef.current?.getContent() ?? props.note.data,
      collapsed: !next,
    });
  };

  const confirmName = () => {
    updateCurrentNote();
  };

  return (
    <div>
      {/* The row click is a mouse convenience; the caret button and the
          editor's focus select the note too, so a keyboard user is not left
          without a way in. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: see above */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above */}
      <div className={classes.container} onClick={selectThis}>
        <button
          type="button"
          className={clsx(
            classes.collapseButton,
            selected ? classes.collapseButtonSelected : '',
          )}
          aria-pressed={selected}
          onClick={toggleEditor}
        >
          {editorOpen ? (
            <Icon icon="caret-down" />
          ) : (
            <Icon icon="caret-right" />
          )}
        </button>
        <div className={classes.titleContainer}>
          <EditableText
            className={classes.titleText}
            alwaysRenderInput={true}
            maxLength={256}
            value={name}
            selectAllOnFocus={false}
            onChange={(value) => setName(value)}
            onConfirm={() => confirmName()}
          />
        </div>
        <div className={classes.toolsContainer}>
          <Button
            icon="trash"
            minimal={true}
            onClick={() => {
              props.removeFunc(props.note.id);
            }}
          ></Button>
          <ReviseNoteButton
            getContent={() => editorRef.current?.getContent() ?? ''}
            proposeContent={(markdown) =>
              editorRef.current?.setContent(markdown)
            }
          />
        </div>
      </div>
      <Collapse isOpen={editorOpen} keepChildrenMounted={false}>
        <RichTextEditor
          ref={setEditorRef}
          markdown={props.note.data}
          onFocus={selectThis}
          onApply={updateCurrentNote}
          onBlur={updateCurrentNote}
          placeholder={t('notePlaceholder')}
        />
      </Collapse>
    </div>
  );
};
