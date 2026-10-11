import { expect, test } from 'vitest';

import { highlightTerms, parseSnippet } from './omniSearchText';

test('highlights every query term, case-insensitively', () => {
  expect(highlightTerms('Pasta Recipe pasta', ['pasta'])).toEqual([
    { text: 'Pasta', match: true },
    { text: ' Recipe ', match: false },
    { text: 'pasta', match: true },
  ]);
});

test('a query with no usable terms is one unmatched part', () => {
  expect(highlightTerms('nothing here', ['   '])).toEqual([
    { text: 'nothing here', match: false },
  ]);
});

test('parses the FTS snippet markers into matches', () => {
  expect(parseSnippet('before [tab] after [note]')).toEqual([
    { text: 'before ', match: false },
    { text: 'tab', match: true },
    { text: ' after ', match: false },
    { text: 'note', match: true },
  ]);
});
