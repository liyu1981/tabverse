import { Button, Collapse, EditableText, Icon } from '@blueprintjs/core';
import React, { useRef, useState } from 'react';

import { Note } from '../../data/note/Note';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';
import classes from './Note.module.scss';

export interface INoteViewProps {
  note: Note;
  removeFunc: (id: string) => void;
  updateFunc: (id: string, params: Partial<Note>) => void;
}

export const NoteView = (props: INoteViewProps) => {
  const [name, setName] = useState(props.note.name);
  // The editor owns the body, and `getContent()` is how it is read back as
  // markdown; note.data is markdown.
  const editorRef = useRef<RichTextEditorHandle>(null);

  const updateCurrentNote = () => {
    props.updateFunc(props.note.id, {
      name,
      data: editorRef.current?.getContent() ?? props.note.data,
    });
  };

  const confirmName = () => {
    updateCurrentNote();
  };
  const [editorOpen, setEditorOpen] = useState(true);
  return (
    <div>
      <div className={classes.container}>
        <button
          type="button"
          className={classes.collapseButton}
          onClick={() => {
            setEditorOpen((lastValue) => {
              if (lastValue) {
                // when we collapse save note data to mem first
                updateCurrentNote();
              }
              return !lastValue;
            });
          }}
        >
          {editorOpen ? (
            <Icon icon="caret-down" />
          ) : (
            <Icon icon="caret-right" />
          )}
        </button>
        <div className={classes.titleContainer}>
          <EditableText
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
        </div>
      </div>
      <Collapse isOpen={editorOpen} keepChildrenMounted={false}>
        <RichTextEditor
          ref={editorRef}
          markdown={props.note.data}
          onBlur={updateCurrentNote}
          placeholder="Write your notes here ..."
        />
      </Collapse>
    </div>
  );
};
