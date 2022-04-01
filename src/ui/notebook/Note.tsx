import { Button, Collapse, EditableText, Icon } from '@blueprintjs/core';
import { EditorState, convertFromRaw, convertToRaw } from 'draft-js';
import { Note } from '../../data/note/Note';
import React, { useState } from 'react';

import { DraftRichEditor } from './DraftRichEditor';
import classes from './Note.module.scss';

export interface INoteViewProps {
  note: Note;
  removeFunc: (id: string) => void;
  updateFunc: (id: string, params: Partial<Note>) => void;
}

export const NoteView = (props: INoteViewProps) => {
  const [name, setName] = useState(props.note.name);
  const [editorState, setEditorState] = useState(
    props.note.data.length > 0
      ? EditorState.createWithContent(
          convertFromRaw(JSON.parse(props.note.data)),
        )
      : EditorState.createEmpty(),
  );

  const updateCurrentNote = () => {
    const currentContent = editorState.getCurrentContent();
    const data = JSON.stringify(convertToRaw(currentContent));
    props.updateFunc(props.note.id, { name, data });
  };

  const confirmName = () => {
    updateCurrentNote();
  };
  const [editorOpen, setEditorOpen] = useState(true);
  return (
    <div>
      <div className={classes.container}>
        <div
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
        </div>
        <div className={classes.titleContainer}>
          <EditableText
            className="bp3-editable-text-fullwidth"
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
        <DraftRichEditor
          editorState={editorState}
          setEditorState={setEditorState}
          onBlur={() => {
            updateCurrentNote();
          }}
        />
      </Collapse>
    </div>
  );
};
