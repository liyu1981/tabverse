/**
 * In-memory filtering for the right-panel lists
 * (`src/data/search/inMemorySearch.ts`).
 *
 * The rule is the same substring test the popup's offline search uses, so this
 * pins that: every term must appear, case-insensitively, in the row's text; an
 * empty query is "no filter"; and a note body is searched as text, not as
 * markdown.
 */
import { describe, expect, test } from 'vitest';

import {
  filterByText,
  markdownToText,
  textMatchesTerms,
  tokenizeFilterText,
} from '../inMemorySearch';

describe('tokenizeFilterText', () => {
  test('lowercases and splits on whitespace', () => {
    expect(tokenizeFilterText('  Foo   Bar ')).toEqual(['foo', 'bar']);
  });

  test('an empty or blank query is no terms', () => {
    expect(tokenizeFilterText('')).toEqual([]);
    expect(tokenizeFilterText('   ')).toEqual([]);
  });
});

describe('textMatchesTerms', () => {
  test('every term must appear, anywhere, case insensitively', () => {
    expect(textMatchesTerms('Read the Manager docs', ['manager'])).toBe(true);
    expect(textMatchesTerms('Read the Manager docs', ['read', 'docs'])).toBe(
      true,
    );
    expect(textMatchesTerms('Read the Manager docs', ['read', 'missing'])).toBe(
      false,
    );
  });
});

describe('filterByText', () => {
  const todos = [
    { id: '1', content: 'buy milk' },
    { id: '2', content: 'read the manager docs' },
    { id: '3', content: 'call the dentist' },
  ];

  const filter = (text: string) =>
    filterByText(todos, (todo) => todo.content, text).map((todo) => todo.id);

  test('an empty query returns the whole list', () => {
    expect(filter('')).toEqual(['1', '2', '3']);
  });

  test('keeps only the rows whose text holds every term', () => {
    expect(filter('manager')).toEqual(['2']);
    expect(filter('the')).toEqual(['2', '3']);
    expect(filter('the docs')).toEqual(['2']);
  });

  test('is case insensitive', () => {
    expect(filter('MANAGER')).toEqual(['2']);
  });

  test('a query nothing matches returns nothing', () => {
    expect(filter('zzz')).toEqual([]);
  });

  test('does not mutate the input list', () => {
    const before = todos.map((todo) => todo.id);
    filter('manager');
    expect(todos.map((todo) => todo.id)).toEqual(before);
  });
});

describe('markdownToText', () => {
  test('strips markdown and decodes the common entities', () => {
    expect(markdownToText('a **bold** word')).toBe('a bold word');
    expect(markdownToText('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  });

  test('block boundaries become spaces so words do not run together', () => {
    expect(markdownToText('foo\n\nbar')).toBe('foo bar');
    expect(markdownToText('- one\n- two')).toBe('one two');
  });

  test('a link keeps its words and loses its target', () => {
    expect(markdownToText('see [the docs](https://x.example)')).toBe(
      'see the docs',
    );
  });

  test('collapses whitespace', () => {
    expect(markdownToText('a\n\n  b')).toBe('a b');
  });

  test('an empty body is empty text', () => {
    expect(markdownToText('')).toBe('');
  });
});
