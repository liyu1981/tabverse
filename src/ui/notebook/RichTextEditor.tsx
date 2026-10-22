import { t, type MessageKey } from '../../i18n';
import React, {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { Icon } from '@blueprintjs/core';
import type { IconName } from '@blueprintjs/icons';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import clsx from 'clsx';

import { NoteReviewDialog } from './NoteReviewDialog';
import classes from './RichTextEditor.module.scss';

/**
 * The note rich text editor.
 *
 * TipTap, and **the document is Markdown**: the editor reads it in and writes
 * it out as markdown (`note.data` holds markdown), through `@tiptap/markdown`
 * over the same schema the toolbar draws.
 *
 * `getContent()` reads the body; `setContent(markdown)` **proposes** one - it
 * does not write. The proposal opens a before/after review dialog
 * (`NoteReviewDialog`), and only the result the person accepts (or edits, or
 * rejects) is written back. That is the rule for anything that drives the
 * editor from outside, the on-device model above all: a model's answer is shown
 * as a diff before it becomes the note.
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
  label: MessageKey;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BLOCK_BUTTONS: IStyleButton[] = [
  {
    icon: 'header-one',
    label: 'editorH1',
    isActive: (e) => e.isActive('heading', { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    icon: 'header-two',
    label: 'editorH2',
    isActive: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    icon: 'header-three',
    label: 'editorH3',
    isActive: (e) => e.isActive('heading', { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    icon: 'citation',
    label: 'editorBlockquote',
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    icon: 'properties',
    label: 'editorUnorderedList',
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    icon: 'numbered-list',
    label: 'editorOrderedList',
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    icon: 'code',
    label: 'editorCodeBlock',
    isActive: (e) => e.isActive('codeBlock'),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

const INLINE_BUTTONS: IStyleButton[] = [
  {
    icon: 'bold',
    label: 'editorBold',
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    icon: 'italic',
    label: 'editorItalic',
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    icon: 'underline',
    label: 'editorUnderline',
    isActive: (e) => e.isActive('underline'),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    icon: 'font',
    label: 'editorMonospace',
    isActive: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    icon: 'strikethrough',
    label: 'editorStrikethrough',
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
      aria-label={t(button.label)}
      aria-pressed={active}
      className={clsx(classes.styleButton, active ? classes.activeButton : '')}
      onMouseDown={(e) => {
        // keep the selection: prevent the editor from losing focus first
        e.preventDefault();
        if (editor) {
          button.run(editor);
        }
      }}
      title={t(button.label)}
    >
      <Icon icon={button.icon} />
    </button>
  );
}

/** Reading and writing the document, for callers that drive the editor. */
export interface RichTextEditorHandle {
  /** The document as Markdown. */
  getContent(): string;
  /**
   * Propose a new document. Does not write: it opens the review dialog, and
   * only the accepted result is applied.
   */
  setContent(markdown: string): void;
  /** Re-open the review for a proposal that has not been decided yet. */
  openReview(): void;
}

interface PendingReview {
  before: string;
  after: string;
}

export interface IRichTextEditorProps {
  /** The initial document, Markdown. */
  markdown: string;
  onChange?: (markdown: string) => void;
  /** Called after the review applies a result, so the owner can save it. */
  onApply?: () => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
  ref?: React.Ref<RichTextEditorHandle>;
}

export function RichTextEditor(props: IRichTextEditorProps) {
  const {
    markdown,
    onChange,
    onApply,
    onBlur,
    onFocus,
    placeholder,
    className,
    ref,
  } = props;

  const [review, setReview] = useState<PendingReview | null>(null);
  const pendingRef = useRef<PendingReview | null>(null);

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
    onFocus: () => {
      onFocus?.();
    },
    onBlur: () => {
      onBlur?.();
    },
  });

  const openReview = useCallback(() => {
    const pending = pendingRef.current;
    if (pending === null || pending.before === pending.after) {
      pendingRef.current = null;
      return;
    }
    setReview(pending);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getContent: () => editor?.getMarkdown() ?? '',
      setContent: (next: string) => {
        const before = editor?.getMarkdown() ?? '';
        if (next === before) {
          return;
        }
        pendingRef.current = { before, after: next };
        openReview();
      },
      openReview,
    }),
    [editor, openReview],
  );

  const decide = useCallback(
    (result: string) => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      setReview(null);
      if (pending !== null && result !== pending.before) {
        // emitUpdate so the owner hears about the applied body like a keystroke
        editor?.commands.setContent(result, {
          contentType: 'markdown',
          emitUpdate: true,
        });
      }
      onApply?.();
    },
    [editor, onApply],
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
      {review ? (
        <NoteReviewDialog
          before={review.before}
          after={review.after}
          onClose={decide}
        />
      ) : null}
    </div>
  );
}
