/**
 * The expandable server console panel (static markup, ADR 0019 / AGENTS.md:
 * no browser).
 *
 * What this pins: the collapsed state is a handle and nothing else (no iframe
 * is created until the panel is opened and a server is paired), each panel
 * state speaks its one line, the ready state carries the exact `/console/` URL
 * and a title, and the way out that always works ("Open in a tab") is there
 * whenever the frame is.
 */
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  consoleUrlOf,
  ServerConsoleDrawer,
  ServerConsoleDrawerPanel,
} from '../ServerConsoleDrawer';

const renderPanel = (
  props: Partial<React.ComponentProps<typeof ServerConsoleDrawerPanel>> = {},
) =>
  renderToStaticMarkup(
    <ServerConsoleDrawerPanel
      state={{ kind: 'unpaired' }}
      onOpenInTab={() => undefined}
      onCollapse={() => undefined}
      {...props}
    />,
  );

describe('consoleUrlOf', () => {
  test('appends /console/ to a bare address', () => {
    expect(consoleUrlOf('https://host:8223')).toBe(
      'https://host:8223/console/',
    );
  });

  test('trailing slashes on the address are one slash, not several', () => {
    expect(consoleUrlOf('https://host:8223/')).toBe(
      'https://host:8223/console/',
    );
    expect(consoleUrlOf('http://192.168.0.221:8223///')).toBe(
      'http://192.168.0.221:8223/console/',
    );
  });

  test('an address with a path keeps it, under /console/', () => {
    expect(consoleUrlOf('http://host/tabversed')).toBe(
      'http://host/tabversed/console/',
    );
  });
});

describe('ServerConsoleDrawer (collapsed)', () => {
  test('is a handle, and creates no frame', () => {
    const markup = renderToStaticMarkup(<ServerConsoleDrawer />);
    expect(markup).toContain('Open the sync server console');
    expect(markup).not.toContain('<iframe');
  });
});

describe('ServerConsoleDrawerPanel', () => {
  test('loading is one line and no frame', () => {
    const markup = renderPanel({ state: { kind: 'loading' } });
    expect(markup).toContain('Reading the sync setup');
    expect(markup).not.toContain('<iframe');
  });

  test('an unreadable config is not reported as unpaired', () => {
    const markup = renderPanel({ state: { kind: 'error' } });
    expect(markup).toContain('Could not read the sync setup');
    expect(markup).not.toContain('Not paired');
    expect(markup).not.toContain('<iframe');
  });

  test('unpaired is one line, no frame, and says where to pair', () => {
    const markup = renderPanel({ state: { kind: 'unpaired' } });
    expect(markup).toContain('Not paired with a server yet');
    expect(markup).toContain('sync button');
    expect(markup).not.toContain('<iframe');
    expect(markup).not.toContain('Open in a tab');
  });

  test('ready shows the frame and the way out, and says why', () => {
    const markup = renderPanel({
      state: { kind: 'ready', url: 'https://host:8223/console/' },
    });
    expect(markup).toContain('src="https://host:8223/console/"');
    expect(markup).toContain('title="Sync server console"');
    expect(markup).toContain('Open in a tab');
    // the URL is shown, because an iframe has no address bar to read
    expect(markup).toContain('https://host:8223/console/');
    // and the signed-out caveat is said in the panel, not only in a comment
    expect(markup).toContain('signed out');
  });

  test('every state can collapse the panel again', () => {
    for (const state of [
      { kind: 'loading' },
      { kind: 'error' },
      { kind: 'unpaired' },
      { kind: 'ready', url: 'https://host/console/' },
    ] as const) {
      const markup = renderPanel({ state });
      expect(markup).toContain('Collapse the server console');
    }
  });
});
