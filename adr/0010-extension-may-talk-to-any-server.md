# ADR 0010: the extension may talk to any server the user names

Status: accepted (2026-09)

Refines [ADR 0002](0002-privacy-posture.md) §5 ("no third parties: the extension
talks to exactly one server, the one the user controls") and supersedes the
localhost-only `connect-src` in the manifest.

## Context

Pairing a server from another machine on the network failed, and the UI said so
in the least useful way possible:

```
Failed: network error for POST /api/v1/auth/pair: Failed to fetch
```

with the real cause only in the service worker console:

```
Connecting to 'http://192.168.0.221:8223/api/v1/auth/pair' violates the
following Content Security Policy directive: "connect-src 'self' https: wss:
http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*".
```

The extension's manifest pinned `connect-src` to `localhost` and `127.0.0.1`,
so any other server - a LAN address, a hostname, a VPS - was refused by Chrome
before the request left the browser. The server was healthy the whole time: its
CORS preflight answers `204` and the pair endpoint answered
`401 invalid_invite` for the same request from `curl`.

The reason for the pin was to look tight, and it was tight in the wrong place.
`host_permissions` already declares `<all_urls>`, so the extension can already
fetch any host; the CSP was the only thing standing between a user's own server
and the extension, and it stood in front of the *legitimate* case rather than
the illegitimate one. It cannot be moved: Chrome's MV3 minimum policy fixes
`script-src` and `object-src` but says nothing about `connect-src`, and the
server's address is not knowable at build time in any case.

## Decision

**`connect-src` is scheme-scoped by default, and host-scoped only on request.**

1. **Default: `connect-src 'self' https: wss: http: ws:`.** Any server, any
   scheme Chrome can reach. This is the same trust decision the manifest already
   makes with `<all_urls>` host permissions, and it is what ADR 0002 §5 actually
   asks for: the server is the one the user controls, not one we know about.
   Plain `http:` is included because self-hosting on a LAN is the common case
   and the alternative is a build that does not work for most of its users.

2. **`TABVERSE_ALLOWED_SERVERS` narrows it** for a user who wants the extension
   pinned to specific servers:
   `TABVERSE_ALLOWED_SERVERS=http://192.168.0.221:8223,https://tv.example.com`.
   Each origin is also allowed over `ws:`/`wss:`, because the sync stream is a
   WebSocket on the same host and spelling out both forms is a footgun that only
   shows up as a failed reconnect. A value that is not an origin fails the
   build: Chrome refuses to load an extension whose CSP it cannot parse, so a
   typo must not be able to ship.

3. **`script-src 'self'`, `object-src 'self'` and `default-src 'self'` are
   untouched** by either mode. Those are what make an extension page safe; the
   server address never was part of that.

4. **The policy lives in one place** (`tools/manifestPolicy.mts`) and is applied
   by the build's manifest plugin, with a test that fails if
   `src/manifest.json`'s checked-in default drifts from it.

## Consequences

- A server on a LAN address, a hostname or a VPS works out of the box, in the
  unpacked dev build and in the store package, with no rebuild.
- The extension will send its device token to whatever host the user configures,
  including over plaintext `http`. That is inherent to self-hosting on a LAN and
  is ADR 0002 §1's "TLS in transit" choice being declined knowingly, not
  overlooked: over a trusted network it is a reasonable trade, over the open
  internet it is not. `TABVERSE_ALLOWED_SERVERS` is the knob for a user who
  wants fewer doors, and the console's own token handling (ADR 0009) is a
  separate decision from this one.
- The failure mode for a genuinely unreachable server is now a normal network
  error instead of a CSP violation, which is what `serverApi.ts` already
  reports.
