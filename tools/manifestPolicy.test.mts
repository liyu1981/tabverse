import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  connectSrcFor,
  DEFAULT_CONNECT_SRC,
  withConnectSrc,
} from './manifestPolicy.mts';

/** The manifest as it is checked in, i.e. what an unpacked build starts from. */
function srcManifest(): {
  content_security_policy: { extension_pages: string };
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
    expect(() => connectSrcFor('http://host/api/v1')).toThrow(
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
