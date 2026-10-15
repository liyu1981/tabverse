import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { NoteReviewBody } from '../NoteReviewDialog';

/**
 * The review dialog's contents, rendered to markup.
 *
 * The `Dialog` around it is a Blueprint portal and renders nothing under
 * `renderToStaticMarkup`, so the body is a separate component (the same note
 * `SettingsDialog` carries) and this is where the diff it draws is checked.
 */

function body(before: string, after: string): string {
  return renderToStaticMarkup(
    <NoteReviewBody before={before} after={after} onClose={() => undefined} />,
  );
}

test('a changed line shows both sides, and the buttons to decide', () => {
  const html = body('a\nold\nc', 'a\nnew\nc');
  expect(html).toContain('Before');
  expect(html).toContain('After');
  expect(html).toContain('old');
  expect(html).toContain('new');
  expect(html).toContain('1 change');
  expect(html).toContain('Reject all');
  expect(html).toContain('Apply 1 change');
});

test('an added line is editable, so it can be changed, not only accepted', () => {
  const html = body('a\nc', 'a\nb\nc');
  expect(html).toContain('textarea');
  expect(html).toContain('Edit added line');
});

test('identical text is "no changes" rather than an empty diff', () => {
  const html = body('same\nlines', 'same\nlines');
  expect(html).toContain('No changes');
});
