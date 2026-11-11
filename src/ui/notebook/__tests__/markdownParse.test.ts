/**
 * Parsing a note's markdown with the editor's own extensions.
 *
 * Notes are stored as markdown and read into TipTap through
 * `@tiptap/markdown` (`RichTextEditor`). That package is the piece that
 * resolves each extension's `parseMarkdown` and calls it, and it has to hand
 * the handler the extension's *context* - `this.options` is what the heading
 * handler reads (`this.options.levels`) to accept a `###` level.
 *
 * This test exists because the failure was invisible until somebody opened a
 * note that starts with a heading: `@tiptap/extension-heading` 3.32 turned its
 * `parseMarkdown` from an arrow function into a method that reads
 * `this.options`, while `@tiptap/markdown` was still pinned a version behind
 * and passed no context, so `this.options` was `undefined` and the editor threw
 * `Cannot read properties of undefined (reading 'levels')`. Versions are
 * checked in `src/__tests__/tiptapVersions.test.ts`; this checks that the parse
 * itself works on the markdown a person actually has in a note.
 */
import { getSchema, resolveExtensions } from '@tiptap/core';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';

function manager(): MarkdownManager {
  // the same list `RichTextEditor` gives `useEditor`, resolved the way the
  // editor resolves it before the Markdown extension builds its manager
  const extensions = resolveExtensions([StarterKit, Placeholder, Markdown]);
  // building the schema is what an editor does on create; a parse without it
  // would only exercise marked
  getSchema(extensions);
  return new MarkdownManager({ extensions });
}

test('a note that starts with a heading parses, as markdown', () => {
  const doc = manager().parse(
    [
      '### leaningtech/webvm: Virtual Machine for the Web',
      '',
      '[https://github.com/leaningtech/webvm](https://github.com/leaningtech/webvm)',
      '',
      'The page details WebVM:',
      '',
      '- **Client-side operation:** Runs entirely within a web browser.',
      '- **Tailscale integration:** Enables secure access to private networks.',
      '',
      'Plain **bold** and *italic* and `code`.',
    ].join('\n'),
  );

  const headings = doc.content?.filter((node) => node.type === 'heading') ?? [];
  expect(headings).toHaveLength(1);
  expect(headings[0].attrs?.level).toEqual(3);
  expect(doc.content?.some((node) => node.type === 'bulletList')).toBe(true);
});

test('a note without block markdown still parses', () => {
  const doc = manager().parse('just a line, with **bold** in it');
  expect(doc.type).toEqual('doc');
  expect(doc.content).toHaveLength(1);
});

test('every heading level the toolbar offers round-trips', () => {
  const parsed = manager().parse('# one\n\n## two\n\n###### six');
  const levels =
    parsed.content
      ?.filter((node) => node.type === 'heading')
      .map((node) => node.attrs?.level) ?? [];
  expect(levels).toEqual([1, 2, 6]);
});
