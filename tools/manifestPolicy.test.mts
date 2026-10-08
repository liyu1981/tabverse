import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  connectSrcFor,
  DEFAULT_CONNECT_SRC,
  withConnectSrc,
} from './manifestPolicy.mts';
import { OFFICIAL_SERVER_URL } from '../src/data/repo/officialServer';

/** The manifest as it is checked in, i.e. what an unpacked build starts from. */
function srcManifest(): {
  content_security_policy: { extension_pages: string };
  externally_connectable?: { matches: string[] };
} {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../src/manifest.json', import.meta.url)),
      'utf-8',
    ),
  );
}

describe('connect-src policy', () => {
  it('allows any http, https, ws or wss server by default', () => {
    // A server on a LAN address is the case that used to fail: the policy only
    // listed localhost, so a fetch to http://192.168.0.221:8223 was refused by
    // the browser and surfaced as a bare "Failed to fetch".
    expect(connectSrcFor(undefined)).toBe(DEFAULT_CONNECT_SRC);
    expect(connectSrcFor('')).toBe(DEFAULT_CONNECT_SRC);
    expect(connectSrcFor('   ')).toBe(DEFAULT_CONNECT_SRC);
    expect(DEFAULT_CONNECT_SRC).toContain('http:');
    expect(DEFAULT_CONNECT_SRC).toContain('ws:');
  });

  it('keeps script-src and object-src strict whatever the server list is', () => {
    // connect-src is the only directive this touches; the directives that make
    // an extension page safe must survive untouched.
    const csp = srcManifest().content_security_policy.extension_pages;
    const narrowed = withConnectSrc(csp, connectSrcFor('http://10.0.0.5:8223'));
    expect(narrowed).toContain("script-src 'self'");
    expect(narrowed).toContain("object-src 'self'");
    expect(narrowed).toContain("default-src 'self'");
    expect(narrowed).toContain(
      'connect-src ' + "'self' http://10.0.0.5:8223 ws://10.0.0.5:8223",
    );
  });

  it('narrows to the allowed servers, with their websocket forms', () => {
    expect(
      connectSrcFor('http://192.168.0.221:8223, https://tv.example.com'),
    ).toBe(
      "'self' http://192.168.0.221:8223 ws://192.168.0.221:8223 " +
        'https://tv.example.com wss://tv.example.com',
    );
  });

  it('rejects a value that is not an origin, at build time', () => {
    // Chrome refuses to load an extension whose CSP it cannot parse, so a typo
    // here has to fail the build rather than ship a broken manifest.
    expect(() => connectSrcFor('192.168.0.221:8223')).toThrow(
      /TABVERSE_ALLOWED_SERVERS/,
    );
    expect(() => connectSrcFor('http://host/console/api/v1')).toThrow(
      /TABVERSE_ALLOWED_SERVERS/,
    );
  });

  it('does not duplicate a directive that is already there', () => {
    const csp = "default-src 'self'; connect-src 'self'; object-src 'self'";
    const once = withConnectSrc(csp, DEFAULT_CONNECT_SRC);
    expect(once.match(/connect-src/g)).toHaveLength(1);
    expect(withConnectSrc(once, DEFAULT_CONNECT_SRC)).toBe(once);
  });

  it('agrees with the checked-in manifest, so the two cannot drift', () => {
    // The build overwrites connect-src, so a stale default in src/manifest.json
    // would only show up in a source install (or a future tool reading it).
    const csp = srcManifest().content_security_policy.extension_pages;
    expect(withConnectSrc(csp, connectSrcFor(undefined))).toBe(csp);
  });
});

describe('externally_connectable policy (adr/0020)', () => {
  it('allows exactly the official server, and agrees with the URL the wizard opens', () => {
    // The manifest narrows *who may send this extension a message* to one
    // origin, and that origin has to be the one the wizard opens - the two are
    // in different files (src/manifest.json and officialServer.ts), and a
    // mismatch would produce a pairing that can never be delivered, which
    // nothing else would notice until somebody tried to pair.
    const manifest = srcManifest();
    expect(manifest.externally_connectable?.matches).toEqual([
      `${new URL(OFFICIAL_SERVER_URL).origin}/*`,
    ]);
  });

  it('never widens the channel to every origin or every extension', () => {
    // A wildcard here would let any page send this extension a token to save,
    // which is the one thing the nonce would then be standing alone against.
    const manifest = srcManifest();
    const matches = manifest.externally_connectable?.matches ?? [];
    expect(matches.some((pattern) => pattern === '*://*/*')).toBe(false);
    expect(matches.some((pattern) => pattern.includes('*.'))).toBe(false);
    // and no "ids" entry: declaring this key without it is what stops *other*
    // extensions from connecting to us, which is the narrowing we want
    expect((manifest.externally_connectable as { ids?: string[] })?.ids).toBe(
      undefined,
    );
  });
});
