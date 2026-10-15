/**
 * The rail's colour plumbing (static markup, AGENTS.md: no browser).
 *
 * The colour is published as the `--sidebar-color` custom property on the
 * container, which is the single value the rail background, the active entry's
 * corner cutouts and the bottom bar read. What this pins: the current
 * tabverse's colour goes in, and anything that is not a palette colour falls
 * back to the default instead of painting an unknown surface.
 */
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { SidebarContainer } from '../SidebarContainer';
import { DEFAULT_SIDEBAR_COLOR } from '../../../data/tabSpace/sidebarColor';
import { tabSpaceStoreApi } from '../../../data/tabSpace/store';

const rail = () =>
  renderToStaticMarkup(
    <SidebarContainer>
      <div>an entry</div>
    </SidebarContainer>,
  );

test('the rail carries the current tabverse colour', () => {
  tabSpaceStoreApi.updateTabSpace({ color: '#472a55' });
  const markup = rail();
  expect(markup).toContain('--sidebar-color:#472a55');
  expect(markup).toContain('an entry');
  tabSpaceStoreApi.updateTabSpace({ color: DEFAULT_SIDEBAR_COLOR });
});

test('a colour that is not ours paints the default', () => {
  tabSpaceStoreApi.updateTabSpace({ color: 'chartreuse' });
  expect(rail()).toContain(`--sidebar-color:${DEFAULT_SIDEBAR_COLOR}`);
  tabSpaceStoreApi.updateTabSpace({ color: DEFAULT_SIDEBAR_COLOR });
});
