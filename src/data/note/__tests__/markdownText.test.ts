import { expect, test } from 'vitest';

import { markdownToPlainText } from '../markdownText';

/**
 * A note body is Markdown written on somebody else's machine, and the console
 * shows it as text on purpose (see the module). These are the cases that decide
 * whether that reading is a good one: the formatting people actually write, and
 * the things that must never come back as text.
 */

test('blocks read as their own lines', () => {
  expect(markdownToPlainText('first\n\nsecond')).toBe('first\n\nsecond');
  expect(markdownToPlainText('- a\n- b')).toBe('a\nb');
  expect(markdownToPlainText('1. a\n2. b')).toBe('a\nb');
});

test('formatting goes, wording stays', () => {
  expect(markdownToPlainText('a **bold** word')).toBe('a bold word');
  expect(markdownToPlainText('an *italic* word')).toBe('an italic word');
  expect(markdownToPlainText('~~gone~~ here')).toBe('gone here');
  expect(markdownToPlainText('++underlined++ text')).toBe('underlined text');
  expect(markdownToPlainText('## Title\nbody')).toBe('Title\nbody');
  expect(markdownToPlainText('> quoted')).toBe('quoted');
  expect(markdownToPlainText('`code` and text')).toBe('code and text');
  expect(markdownToPlainText('```\nconst a = 1;\n```')).toBe('const a = 1;');
});

test('a link keeps its words and loses its target', () => {
  // An operator can read what a note linked to; they cannot click it, because a
  // click is an action and this page holds the account.
  expect(markdownToPlainText('see [the docs](https://x.example)')).toBe(
    'see the docs',
  );
  expect(markdownToPlainText('![alt](https://x/a.png)')).toBe('alt');
});

test('raw HTML is dropped, and script and style go with their contents', () => {
  expect(markdownToPlainText('keep <b>this</b>')).toBe('keep this');
  const html =
    'keep\n\n<script>alert(1)</script>\n\n<style>.a{color:red}</style>';
  expect(markdownToPlainText(html)).toBe('keep');
  // ...including an unclosed one, whose text is code too.
  expect(markdownToPlainText('keep\n\n<script>alert(1)')).toBe('keep');
});

test('entities are decoded after the markup is gone', () => {
  // Decoding first would turn `&lt;b&gt;` back into a tag, which the line
  // above would then remove.
  expect(markdownToPlainText('&lt;b&gt;not bold&lt;/b&gt;')).toBe(
    '<b>not bold</b>',
  );
  expect(markdownToPlainText('a &amp; b')).toBe('a & b');
  expect(markdownToPlainText('&#65;&#x42;')).toBe('AB');
});

test('nothing at all is nothing at all', () => {
  expect(markdownToPlainText('')).toBe('');
  expect(markdownToPlainText('   \n  ')).toBe('');
});
