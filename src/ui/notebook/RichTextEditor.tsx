import React, { useImperativeHandle } from 'react';

import { Icon } from '@blueprintjs/core';
import type { IconName } from '@blueprintjs/icons';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import clsx from 'clsx';

import classes from './RichTextEditor.module.scss';

/**
 * The note rich text editor.
 *
 * TipTap, and **the document is Markdown**: the editor reads it in and writes
 * it out as markdown (`note.data` holds markdown), through `@tiptap/markdown`
 * over the same schema the toolbar draws. `getContent`/`setContent` are the
 * API for anything that drives the editor programmatically - the on-device
 * model above all, which answers in markdown.
 *
 * The styling vocabulary is the schema, and the markdown that maps to it:
 * paragraphs and hard breaks, `#`-`######` headings, `-`/`1.` lists, `>`
 * blockquotes, fenced code, `---`, `**bold**`, `*italic*`, `~~strike~~`,
 * `` `code` ``, `[text](url)`, and `++underline++` (Tiptap's own syntax; not
 * CommonMark). Underline is the one extension markdown has no standard for.
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

/** Reading and writing the document, for callers that drive the editor. */
export interface RichTextEditorHandle {
  /** The document as Markdown. */
  getContent(): string;
  /** Replace the document with Markdown. */
  setContent(markdown: string): void;
}

export interface IRichTextEditorProps {
  /** The initial document, Markdown. */
  markdown: string;
  onChange?: (markdown: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  ref?: React.Ref<RichTextEditorHandle>;
}

export function RichTextEditor(props: IRichTextEditorProps) {
  const { markdown, onChange, onBlur, placeholder, className, ref } = props;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder || '' }),
      Markdown,
    ],
    content: markdown || '',
    // The document is markdown, in and out, so the whole schema's markdown
    // handlers apply to what a caller passes in.
    contentType: 'markdown',
    editorProps: {
      attributes: {
        spellcheck: 'true',
      },
    },
    onUpdate: (update) => {
      onChange?.(update.editor.getMarkdown());
    },
    onBlur: () => {
      if (onBlur) {
        onBlur();
      }
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      getContent: () => editor?.getMarkdown() ?? '',
      setContent: (next: string) => {
        // emitUpdate so a controlled caller hears about a programmatic set the
        // same way it hears about typing
        editor?.commands.setContent(next, {
          contentType: 'markdown',
          emitUpdate: true,
        });
      },
    }),
    [editor],
  );

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
