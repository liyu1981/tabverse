# ADR 0030: a note body is Markdown

Status: accepted (2026-10)

Supersedes the storage-format part of
[ADR 0004](0004-strictness-react19-tiptap.md) (TipTap replaced draft-js) and the
"a note body is text" detail of
[ADR 0019](0019-the-tabverse-view-is-shared.md).

## Context

ADR 0004 made `note.data` HTML: what TipTap produced. That was a reasonable
internal format, but the editor had no way to be driven by text a model writes,
and the on-device AI work wants exactly that - the note editor is where a
model's answer lands, and a model that can style its answer needs a format it
can emit and the editor can read.

TipTap v3 ships markdown support in the extensions themselves (`parseMarkdown` /
`renderMarkdown` on each), and `@tiptap/markdown` orchestrates it over the same
schema the toolbar draws. So the codec exists; what was missing was choosing it.

## Decision

**`note.data` is Markdown, and the editor's content interface is Markdown.**

1. `RichTextEditor` registers the `Markdown` extension and reads and writes
   markdown: `contentType: 'markdown'`, `editor.getMarkdown()`.
2. It exposes `getContent()` / `setContent(markdown)` through a ref
   (`RichTextEditorHandle`). That is the interface for anything that drives the
   editor, the model included; `Note.tsx` reads the body back with
   `getContent()` rather than keeping a parallel copy in state.
3. The styling vocabulary is the schema's markdown: `#`-`######` headings,
   `-`/`1.` lists, `>` blockquotes, fenced code, `---`, `**bold**`, `*italic*`,
   `~~strike~~`, `` `code` ``, `[text](url)`, and `++underline++` (TipTap's own
   syntax - CommonMark has no underline).
4. Everything that read `note.data` as HTML reads markdown instead: the
   extension's in-list filter and the console's read-only note card both go
   through `src/data/note/markdownText.ts`, and a summary note is built as
   markdown (`src/ai/summarize.ts`).
5. No migration is written: the change is accepted for the deployment that asked
   for it (a single-user instance). The legacy draft-js converter
   (`src/ui/notebook/draftLegacy.ts`) is deleted with the HTML format.

## Consequences

- A model can now emit the note body directly. The summarize prompt still asks
  for plain text and the code turns that into markdown, so letting the model
  *style* its answer is a prompt change, not a parser change.
- Markdown is lossy for underline (`++` is Tiptap's, not CommonMark) and may
  normalize link/code-block attributes. Round-trips are checked against the
  actual schema, not assumed.
- Notes written before this change are HTML and are **not** converted; they read
  as literal text until rewritten. Accepted deliberately (single-user instance).
- The console still does not render the body as markup: markdown allows raw
  HTML, so `markdownToPlainText` strips raw HTML and markdown alike, and the
  console keeps its `<pre>`.
- `Underline` was also dropped as a direct dependency: StarterKit already
  includes it, and the editor was registering it twice.
