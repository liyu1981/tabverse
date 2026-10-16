/**
 * The Markdown view body (`src/ui/manager/TabSpace/MarkdownViewDialog.tsx`),
 * checked by what it renders (AGENTS.md: no browser).
 *
 * Blueprint's `Dialog` renders through a portal, so only the body can be seen
 * under `renderToStaticMarkup`; that is the part with the Markdown and the
 * copy state.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { MarkdownViewBody } from '../MarkdownViewDialog';

describe('MarkdownViewBody', () => {
  test('shows the title and the Markdown verbatim', () => {
    const markup = renderToStaticMarkup(
      <MarkdownViewBody
        title="A page about tabs"
        markdown={'# Heading\n\n- one\n- two'}
        copied={false}
        onCopy={() => undefined}
      />,
    );
    expect(markup).toContain('A page about tabs');
    expect(markup).toContain('Heading');
    expect(markup).toContain('- one');
    expect(markup).toContain('Copy Markdown');
  });

  test('the button says so for a moment after a copy', () => {
    const markup = renderToStaticMarkup(
      <MarkdownViewBody
        title="A page"
        markdown="# Heading"
        copied={true}
        onCopy={() => undefined}
      />,
    );
    expect(markup).toContain('Copied');
  });
});
