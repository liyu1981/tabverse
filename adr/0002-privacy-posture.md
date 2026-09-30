# ADR 0002: privacy posture of the sync server

Status: accepted (2026-09)

## Context

Tabverse previously never transmitted user data anywhere except an optional
user-configured Dropbox dump. A sync server changes that: tab URLs, titles,
notes and todos are sensitive browsing data.

Server side full text search (ADR 0001 §6) is incompatible with
end-to-end encryption: the server must be able to read what it indexes.

## Decision

For v1:

1. **Plaintext at rest, TLS in transit.** The server stores JSON payloads in
   SQLite; traffic is HTTPS/WSS. Operators who want more can put the SQLite
   file on an encrypted volume.
2. **Opt-in only.** No configuration means local-only operation, byte for
   byte the old behavior. Nothing is uploaded until the user pairs a device.
3. **An informed default, not a silent one.** Setting sync up uploads the data
   already on the device, and the box is **ticked by default**. The requirement
   this replaces ("a separate button, pairing alone does not move existing
   data") made the first setup a surprising dead end: the user pairs, sees an
   empty server, and has to discover a second button. The default is kept
   *legible* instead of quiet: the dialog counts what would be sent ("this
   device holds N records, M tabverses, T tabs"), the primary button says
   "Pair & upload local data" while the box is ticked, the upload reports
   progress, and unticking it is one click and says what it means ("your
   existing data stays on this device"). The separate "Upload local data"
   button stays, for data created while disconnected and for retrying a failed
   upload. An upload that fails after a successful pairing is reported as a
   failed *upload* - the device is paired and the local copy is intact.
4. **Server side retention** defaults to pruning `session` snapshots after
   14 days (`TABVERSED_RETENTION_DAYS`, 0 = keep forever). The extension no
   longer records snapshots at all (`adr/0006`); retention remains for older
   clients and can go with the `session` entity.
5. **No third parties.** The extension talks to exactly one server, the one
   the user typed. Which servers it is *allowed* to reach is scheme-scoped by
   default (`connect-src 'self' https: wss: http: ws:`), narrowed on request by
   `TABVERSE_ALLOWED_SERVERS` - see [ADR 0010](0010-extension-may-talk-to-any-server.md).

## Consequences

- Chrome Web Store **data collection/use disclosures must be updated**:
  the extension now can collect browsing history + user content, stored on a
  server the user controls, not sold or shared.
- The privacy policy (`docs/privacy`) must describe the sync feature,
  retention, and that local-only mode remains available.
- E2E encryption is explicitly deferred: it would force search back into the
  client and reintroduce the index the server was meant to replace. If this
  ever becomes a requirement, ADR 0001 §6 must be revisited.
- Self-hosting is the recommended deployment (`tabversed` is a single static
  binary), which keeps the trust story simple: the user chooses the server.
