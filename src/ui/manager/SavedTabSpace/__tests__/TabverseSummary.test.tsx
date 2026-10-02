import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { TabverseSummary } from '../TabverseSummary';

/**
 * The line both pages draw, asserted once.
 *
 * The console's tabverse drawer renders this same component (adr/0019), so its
 * wording is not a second implementation to keep in step - but the *reading* of
 * the counts still is: a tabverse with no groups must not say "in 0 groups",
 * and one tab is not two tabs.
 */

/** The text a reader sees, with the bold the counts carry taken out. */
function say(props: { tabCount: number; groupCount: number }): string {
  return renderToStaticMarkup(<TabverseSummary {...props} />)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

test('the summary reads as the extension has always written it', () => {
  expect(say({ tabCount: 7, groupCount: 2 })).toBe(
    'Working on 7 tabs in 2 groups',
  );
});

test('singulars are singular, and no groups is no clause', () => {
  expect(say({ tabCount: 1, groupCount: 0 })).toBe('Working on 1 tab');
  expect(say({ tabCount: 4, groupCount: 1 })).toBe(
    'Working on 4 tabs in 1 group',
  );
  // "in 0 groups" would be a sentence about nothing.
  expect(say({ tabCount: 0, groupCount: 0 })).toBe('Working on 0 tabs');
});

test('the counts are the ones that matter, not the rows a listing counted', () => {
  // A tab whose record is gone still counts if the tabverse's own tabIds lists
  // it: the line describes what the tabverse *is*, not what the server returned.
  expect(say({ tabCount: 3, groupCount: 2 })).toContain('3 tabs');
});
