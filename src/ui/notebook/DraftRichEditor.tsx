import classes from './DraftRichEditor.module.scss';

import * as React from 'react';

import { Editor, RichUtils, getDefaultKeyBinding } from 'draft-js';

import { Icon } from '@blueprintjs/core';
import clsx from 'clsx';

const { useRef, useCallback } = React;

function getBlockStyle(block) {
  switch (block.getType()) {
    case 'blockquote':
      return classes.blockquote;
    default:
      return null;
  }
}

function StyleButton({ onToggle, active, icon, label, style }) {
  return (
    <span
      className={clsx(classes.styleButton, active ? classes.activeButton : '')}
      onMouseDown={(e) => {
        e.preventDefault();
        onToggle(style);
      }}
      title={label}
    >
      <Icon icon={icon} />
    </span>
  );
}

function BlockStyleControls({ editorState, onToggle }) {
  const selection = editorState.getSelection();
  const blockType = editorState
    .getCurrentContent()
    .getBlockForKey(selection.getStartKey())
    .getType();

  const BLOCK_TYPES = [
    { icon: 'header-one', label: 'H1', style: 'header-one' },
    { icon: 'header-two', label: 'H2', style: 'header-two' },
    { icon: 'header-three', label: 'H3', style: 'header-three' },
    { icon: 'citation', label: 'Blockquote', style: 'blockquote' },
    {
      icon: 'properties',
      label: 'Unordered List',
      style: 'unordered-list-item',
    },
    {
      icon: 'numbered-list',
      label: 'Ordered List',
      style: 'ordered-list-item',
    },
    { icon: 'code', label: 'Code Block', style: 'code-block' },
  ];

  return (
    <div className={classes.controls}>
      {BLOCK_TYPES.map((type) => (
        <StyleButton
          key={type.label}
          active={type.style === blockType}
          label={type.label}
          icon={type.icon}
          onToggle={onToggle}
          style={type.style}
        />
      ))}
    </div>
  );
}

function InlineStyleControls({ editorState, onToggle }) {
  const currentStyle = editorState.getCurrentInlineStyle();
  const INLINE_STYLES = [
    { icon: 'bold', label: 'Bold', style: 'BOLD' },
    { icon: 'italic', label: 'Italic', style: 'ITALIC' },
    { icon: 'underline', label: 'Underline', style: 'UNDERLINE' },
    { icon: 'font', label: 'Monospace', style: 'CODE' },
    { icon: 'strikethrough', label: 'Strikethrough', style: 'STRIKETHROUGH' },
  ];
  return (
    <div className={classes.controls}>
      {INLINE_STYLES.map((type) => (
        <StyleButton
          key={type.label}
          active={currentStyle.has(type.style)}
          label={type.label}
          icon={type.icon}
          onToggle={onToggle}
          style={type.style}
        />
      ))}
    </div>
  );
}

// Custom overrides for "code" style.
const styleMap = {
  CODE: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    fontFamily: '"Inconsolata", "Menlo", "Consolas", monospace',
    fontSize: 16,
    padding: 2,
  },
  STRIKETHROUGH: {
    textDecoration: 'line-through',
  },
};

export function DraftRichEditor({ editorState, setEditorState, onBlur }) {
  const editor = useRef(null);

  const focus = () => {
    if (editor.current) editor.current.focus();
  };

  const handleKeyCommand = useCallback(
    (command, editorState) => {
      const newState = RichUtils.handleKeyCommand(editorState, command);
      if (newState) {
        setEditorState(newState);
        return 'handled';
      }
      return 'not-handled';
    },
    [editorState, setEditorState],
  );

  const mapKeyToEditorCommand = useCallback(
    (e) => {
      const newEditorState = RichUtils.onTab(e, editorState, 4 /* maxDepth */);
      switch (e.keyCode) {
        case 9: // TAB
          if (newEditorState !== editorState) {
            setEditorState(newEditorState);
          }
          return null;
      }
      return getDefaultKeyBinding(e);
    },
    [editorState, setEditorState],
  );

  // If the user changes block type before entering any text, we can
  // either style the placeholder or hide it. Let's just hide it now.
  let className = classes.editor;
  const contentState = editorState.getCurrentContent();
  if (!contentState.hasText()) {
    if (contentState.getBlockMap().first().getType() !== 'unstyled') {
      className = clsx(className, classes.hidePlaceholder);
    }
  }

  return (
    <div className={classes.root}>
      <div className={classes.toolbar}>
        <InlineStyleControls
          editorState={editorState}
          onToggle={(inlineStyle) => {
            const newState = RichUtils.toggleInlineStyle(
              editorState,
              inlineStyle,
            );
            setEditorState(newState);
          }}
        />
        <BlockStyleControls
          editorState={editorState}
          onToggle={(blockType) => {
            const newState = RichUtils.toggleBlockType(editorState, blockType);
            setEditorState(newState);
          }}
        />
      </div>
      <div className={className} onClick={focus}>
        <Editor
          blockStyleFn={getBlockStyle}
          customStyleMap={styleMap}
          editorState={editorState}
          handleKeyCommand={handleKeyCommand}
          keyBindingFn={mapKeyToEditorCommand}
          onChange={setEditorState}
          onBlur={onBlur}
          placeholder="Write your notes here ..."
          ref={editor}
          spellCheck={true}
        />
      </div>
    </div>
  );
}
