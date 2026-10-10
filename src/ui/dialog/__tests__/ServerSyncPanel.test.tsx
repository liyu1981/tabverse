import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  ServerSyncPanel,
  initialSyncTab,
  setupLabelOf,
} from '../ServerSyncPanel';
import type { SyncConfig } from '../../../data/repo/syncConfig';

/**
 * The sync dialog, as far as a static render can reach it (adr/0020).
 *
 * The dialog's content sits behind a `useEffect` that reads the config, and a
 * static render runs no effects - so what can be checked here is that the
 * component renders at all (the blank-page guard this repo tests everywhere),
 * and the two decisions the tabs are built on, which were deliberately pulled
 * out so they could be: which tab a fresh dialog opens on, and how the status
 * names the server this device is on.
 *
 * The tab layout itself - two tabs, a switch between the two ways to set up -
 * is what the user checks in a browser: AGENTS.md forbids driving one here.
 */

const OFFICIAL: SyncConfig = {
  baseUrl: 'https://tabversed.liyu1981.xyz',
  token: 't',
  userId: 'usr_1',
  deviceId: 'dev_1',
  enabled: true,
  kind: 'official',
};

const CUSTOM: SyncConfig = {
  baseUrl: 'http://192.168.0.221:8223',
  token: 't',
  enabled: true,
  kind: 'custom',
};

test('the panel renders its first paint rather than throwing', () => {
  // the blank-page guard: a component that cannot be rendered is one that
  // cannot be opened, and nothing else in the build would notice
  const html = renderToStaticMarkup(<ServerSyncPanel />);
  expect(html).toContain('bp6-spinner');
});

test('a fresh dialog opens on Setup when there is nothing set up', () => {
  expect(initialSyncTab(null)).toEqual('setup');
  // and on Status once there is: the state the person is in, not the tab they
  // happened to be on last time
  expect(initialSyncTab(OFFICIAL)).toEqual('status');
  expect(initialSyncTab(CUSTOM)).toEqual('status');
});

test('the status says which of the two ways this device was paired with', () => {
  expect(setupLabelOf(OFFICIAL)).toEqual('Tabverse official server');
  expect(setupLabelOf(CUSTOM)).toEqual('your own server (pairing code)');
  // a config written before the wizard existed has no kind, and it was a code
  // pairing (syncConfig.ts says so)
  expect(setupLabelOf({ ...CUSTOM, kind: undefined })).toEqual(
    'your own server (pairing code)',
  );
  expect(setupLabelOf(null)).toEqual('your own server (pairing code)');
});
