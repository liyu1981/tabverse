/**
 * The Launchpad's markup, rendered to a string: the shape a browser would get,
 * with no DOM (AGENTS.md). Clicking, hovering and the icon's onError fallback
 * are for the person to check; what is pinned here is the link, the name, the
 * labelled delete button and the three states the page can be in.
 */
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { LaunchpadGrid } from '../LaunchpadGrid';
import { Shortcut } from '../../../data/shortcut/Shortcut';

function shortcut(overrides: Partial<Shortcut> = {}): Shortcut {
  return {
    id: 's1',
    name: 'Figma',
    url: 'https://www.figma.com/',
    iconDataUrl: '',
    iconUrl: '',
    favIconUrl: '',
    createdAt: 1,
    updatedAt: 1,
    version: 12,
    ...overrides,
  };
}

function render(
  shortcuts: Shortcut[],
  total = shortcuts.length,
  filtering = false,
): string {
  return renderToStaticMarkup(
    <LaunchpadGrid
      shortcuts={shortcuts}
      total={total}
      filtering={filtering}
      onDelete={() => undefined}
    />,
  );
}

test('an empty Launchpad says so and says where shortcuts come from', () => {
  const html = render([], 0);
  expect(html).toContain('Your Launchpad is empty');
  expect(html).toContain('toolbar popup');
  expect(html).not.toContain('<ul');
});

test('a filter that finds nothing is not the empty state', () => {
  const html = render([], 3, true);
  expect(html).toContain('No shortcut matches the filter.');
  expect(html).not.toContain('Your Launchpad is empty');
});

test('a tile is a new-tab link with the name and a labelled delete button', () => {
  const html = render([
    shortcut({ id: 'g', name: 'GitHub', url: 'https://github.com/' }),
  ]);
  expect(html).toContain('href="https://github.com/"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('>GitHub<');
  expect(html).toContain('aria-label="Remove GitHub from the Launchpad"');
  expect(html).toContain('title="GitHub"');
});

test('the stored bytes win over the source url and the favicon', () => {
  const html = render([
    shortcut({
      iconDataUrl: 'data:image/png;base64,AAA',
      iconUrl: 'https://www.figma.com/apple.png',
      favIconUrl: 'https://www.figma.com/favicon.ico',
    }),
  ]);
  expect(html).toContain('src="data:image/png;base64,AAA"');
  expect(html).not.toContain('apple.png');
});

test('a source url is the second choice, the favicon the third', () => {
  const html = render([
    shortcut({
      iconUrl: 'https://www.figma.com/apple.png',
      favIconUrl: 'https://www.figma.com/favicon.ico',
    }),
  ]);
  expect(html).toContain('src="https://www.figma.com/apple.png"');
  expect(html).not.toContain('favicon.ico');

  const faviconOnly = render([
    shortcut({ favIconUrl: 'https://www.figma.com/favicon.ico' }),
  ]);
  expect(faviconOnly).toContain('src="https://www.figma.com/favicon.ico"');
});

test('no picture at all draws the monogram', () => {
  const html = render([shortcut({ name: 'Linear' })]);
  expect(html).toContain('>L<');
  expect(html).not.toContain('<img');
});

test('a hostile icon url is dropped, not drawn', () => {
  const html = render([
    shortcut({
      iconDataUrl: 'javascript:alert(1)',
      iconUrl: 'file:///tmp/x.png',
      favIconUrl: 'data:text/html,<script>x</script>',
    }),
  ]);
  expect(html).not.toContain('<img');
  expect(html).toContain('>F<');
});

test('a row whose url is not http(s) is not a link', () => {
  const html = render([
    shortcut({ name: 'Settings', url: 'chrome://settings' }),
  ]);
  expect(html).not.toContain('href="chrome://settings"');
  expect(html).not.toContain('>Settings<');
});
