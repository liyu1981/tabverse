/**
 * The right side panel's rail and view switch (static markup, ADR 0019 /
 * AGENTS.md: no browser).
 *
 * What this pins: the collapsed rail carries one button per view (the server
 * console and the AI history live here, not in the tabverse tools), a chosen
 * view opens in the panel with its own title and body, the header can switch
 * between the two without closing first, and every state can collapse back.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { RightSidePanelShell } from '../RightSidePanel';

const render = (
  props: Partial<React.ComponentProps<typeof RightSidePanelShell>> = {},
) =>
  renderToStaticMarkup(
    <RightSidePanelShell
      view={null}
      onSelectView={() => undefined}
      onCollapse={() => undefined}
      {...props}
    />,
  );

describe('the collapsed rail', () => {
  test('offers one button per view, and no panel', () => {
    const markup = render({ view: null });
    expect(markup).toContain('Open the AI history');
    expect(markup).toContain('Open the Server console');
    expect(markup).not.toContain('<aside');
    expect(markup).not.toContain('<iframe');
  });
});

describe('the open panel', () => {
  test('the AI history is the AI-history view', () => {
    const markup = render({ view: 'ai' });
    expect(markup).toContain('aria-label="AI history"');
    // the header names it, and so does the body's own read (a spinner: the
    // prompt log is read in an effect, which static markup does not run)
    expect(markup).toContain('AI history');
    expect(markup).toContain('bp6-spinner');
    expect(markup).not.toContain('Reading the sync setup');
  });

  test('the server console is the console view', () => {
    const markup = render({ view: 'server' });
    expect(markup).toContain('aria-label="Server console"');
    expect(markup).toContain('Reading the sync setup');
    expect(markup).not.toContain('bp6-spinner');
  });

  test('the header can switch views without collapsing first', () => {
    const markup = render({ view: 'server' });
    expect(markup).toContain('Show the AI history');
    expect(markup).toContain('Show the Server console');
  });

  test('every open view can collapse the panel', () => {
    expect(render({ view: 'ai' })).toContain('Collapse the right panel');
    expect(render({ view: 'server' })).toContain('Collapse the right panel');
  });
});
