import React from 'react';

import { Icon } from '@blueprintjs/core';
import type { IconName } from '@blueprintjs/icons';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import clsx from 'clsx';

import classes from './RichTextEditor.module.scss';

/**
 * The note rich text editor.
 *
 * TipTap replaced the archived draft-js: the document is plain HTML (stored
 * in `note.data`), legacy draft content is converted once by
 * `../notebook/draftLegacy`. The toolbar mirrors the old one: block styles
 * (H1-H3, quote, lists, code block) and inline styles.
 */

type Editor = NonNullable<ReturnType<typeof useEditor>>;

interface IStyleButton {
  icon: IconName;
  label: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BLOCK_BUTTONS: IStyleButton[] = [
  {
    icon: 'header-one',
    label: 'H1',
    isActive: (e) => e.isActive('heading', { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    icon: 'header-two',
    label: 'H2',
    isActive: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    icon: 'header-three',
    label: 'H3',
    isActive: (e) => e.isActive('heading', { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    icon: 'citation',
    label: 'Blockquote',
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    icon: 'properties',
    label: 'Unordered List',
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    icon: 'numbered-list',
    label: 'Ordered List',
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    icon: 'code',
    label: 'Code Block',
    isActive: (e) => e.isActive('codeBlock'),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

const INLINE_BUTTONS: IStyleButton[] = [
  {
    icon: 'bold',
    label: 'Bold',
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    icon: 'italic',
    label: 'Italic',
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    icon: 'underline',
    label: 'Underline',
    isActive: (e) => e.isActive('underline'),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    icon: 'font',
    label: 'Monospace',
    isActive: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    icon: 'strikethrough',
    label: 'Strikethrough',
    isActive: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
];

function StyleButton(props: { button: IStyleButton; editor: Editor | null }) {
  const { button, editor } = props;
  const active = editor ? button.isActive(editor) : false;
  return (
    <button
      type="button"
      aria-label={button.label}
      aria-pressed={active}
      className={clsx(classes.styleButton, active ? classes.activeButton : '')}
      onMouseDown={(e) => {
        // keep the selection: prevent the editor from losing focus first
        e.preventDefault();
        if (editor) {
          button.run(editor);
        }
      }}
      title={button.label}
    >
      <Icon icon={button.icon} />
    </button>
  );
}

export interface IRichTextEditorProps {
  /** HTML document (legacy draft-js content is normalized by the caller). */
  html: string;
  onChange: (html: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor(props: IRichTextEditorProps) {
  const { html, onChange, onBlur, placeholder, className } = props;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: placeholder || '' }),
    ],
    content: html || '',
    editorProps: {
      attributes: {
        spellcheck: 'true',
      },
    },
    onUpdate: (update) => {
      onChange(update.editor.getHTML());
    },
    onBlur: () => {
      if (onBlur) {
        onBlur();
      }
    },
  });

  return (
    <div className={clsx(classes.root, className)}>
      <div className={classes.toolbar}>
        <div className={classes.controls}>
          {BLOCK_BUTTONS.map((button) => (
            <StyleButton key={button.label} button={button} editor={editor} />
          ))}
        </div>
        <div className={classes.controls}>
          {INLINE_BUTTONS.map((button) => (
            <StyleButton key={button.label} button={button} editor={editor} />
          ))}
        </div>
      </div>
      <div className={classes.editor}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
