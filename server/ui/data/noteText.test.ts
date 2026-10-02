import { expect, test } from 'vitest';

import { normalizeNoteHtml } from '../../../src/ui/notebook/draftLegacy';
import { htmlToPlainText } from './noteText';

/**
 * A note body is HTML somebody else's machine wrote, and the console shows it
 * as text on purpose (see the module). These are the cases that decide whether
 * that reading is a good one: the formatting people actually write, and the
 * things that must never come back as text.
 */

test('a paragraph reads as its own line', () => {
  expect(htmlToPlainText('<p>first</p><p>second</p>')).toBe('first\nsecond');
  expect(htmlToPlainText('one<br>two')).toBe('one\ntwo');
  expect(htmlToPlainText('<ul><li>a</li><li>b</li></ul>')).toBe('a\nb');
});

test('formatting goes, wording stays', () => {
  expect(htmlToPlainText('<p>a <strong>bold</strong> word</p>')).toBe(
    'a bold word',
  );
  expect(htmlToPlainText('<h2>Title</h2><p>body</p>')).toBe('Title\nbody');
});

test('a link keeps its words and loses its href', () => {
  // An operator can read what a note linked to; they cannot click it, because a
  // click is an action and this page holds the account.
  expect(
    htmlToPlainText('<p>see <a href="https://x.example">the docs</a></p>'),
  ).toBe('see the docs');
});

test('script and style go with their contents, not as text', () => {
  const html =
    '<p>keep</p><script>alert(1)</script><style>.a{color:red}</style>';
  expect(htmlToPlainText(html)).toBe('keep');
  // ...including an unclosed one, whose text is code too.
  expect(htmlToPlainText('<p>keep</p><script>alert(1)')).toBe('keep');
});

test('entities are decoded after the tags are gone', () => {
  // Decoding first would turn `&lt;b&gt;` back into a tag.
  expect(htmlToPlainText('<p>&lt;b&gt;not bold&lt;/b&gt;</p>')).toBe(
    '<b>not bold</b>',
  );
  expect(htmlToPlainText('<p>a &amp; b</p>')).toBe('a & b');
  expect(htmlToPlainText('<p>&#65;&#x42;</p>')).toBe('AB');
});

test('nothing at all is nothing at all', () => {
  expect(htmlToPlainText('')).toBe('');
  expect(htmlToPlainText('   \n  ')).toBe('');
});

test('a legacy draft-js note reads as text too', () => {
  // The extension converts the old format on read; the console reuses that
  // conversion so an old note is not a wall of JSON here.
  const legacy = JSON.stringify({
    blocks: [
      {
        key: 'abc',
        text: 'from draft-js',
        type: 'unstyled',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
        data: {},
      },
    ],
    entityMap: {},
  });
  expect(htmlToPlainText(normalizeNoteHtml(legacy))).toContain('from draft-js');
});
