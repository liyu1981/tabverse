# ADR 0031: a proposed note edit is reviewed before it is applied

Status: accepted (2026-10)

Extends [ADR 0030](0030-note-content-is-markdown.md) (a note body is Markdown,
and the editor's content interface is `getContent`/`setContent`).

## Context

ADR 0030 gave the editor a markdown content interface so the on-device model can
write a note body. But `setContent` wrote straight into the document: a model's
answer - or any programmatic edit - replaced the note with no reading, no
undo, and nothing to compare against. For a feature whose whole point is that a
language model writes the text, that is the wrong default. The same problem was
already solved in `sifpress`: `setContent` staged a proposal, and a before/after
diff let the person accept, edit or reject it.

## Decision

**`setContent` proposes; a review dialog decides.**

1. `RichTextEditorHandle.setContent(markdown)` no longer writes. It takes the
   current body as `before`, the argument as `after`, and opens
   `NoteReviewDialog`. `openReview()` re-opens an undecided proposal.
2. `NoteReviewDialog` is the whole-document before/after:
   - a line diff (`src/data/note/diff.ts`: `buildDiff`/`recompose`/`changeStats`,
     over `diffArrays` from `jsdiff`) into context and change blocks;
   - a per-change-block revert, an inline edit per added line, and word-level
     highlighting of paired lines (`src/data/note/diffWords.ts`);
   - **Reject all** applies `before`; **Apply** applies `recompose(...)` of the
     current choices.
3. Only the result is written, through the editor's own markdown parser.
   `getContent()` is unchanged and always reads the live document; nothing is
   hidden while a proposal is pending.
4. `Note.tsx` saves on apply (`onApply`), because the review is modal and the
   editor may not blur.
5. The first real caller is the summarize action: when a note is being edited,
   the summary is proposed into it (and reviewed) instead of always becoming a
   new note. `src/ui/notebook/activeNoteEditor.ts` is the one slot that connects
   the tab card's action to the notebook's editor; focus sets it.

## Consequences

- A model's answer is never applied unseen: the diff is the document, and the
  person can change any added line before it lands.
- The recomposed markdown is re-parsed by TipTap on apply, so it can normalize
  (e.g. `*` to `_`, fence style). Accepted: the person sees the markdown they
  are accepting, and the editor's rendering is the authority.
- Editing a changed line can break surrounding markdown structure; the same
  normalization applies, and nothing worse than a bad-looking note happens.
- The diff is line-oriented and whole-document. Selection-scoped revisions
  (`updateSelection` in sifpress) are deliberately not built here.
- `diff` (`jsdiff`) is a new dependency, bundled into the extension; the dialog
  is Blueprint + a CSS module, so no UI library was added.
