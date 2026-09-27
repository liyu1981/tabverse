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
3. **Explicit consent before the first upload.** The "Upload local data"
   action in the sync dialog is a separate, deliberate button — pairing alone
   does not move existing data.
4. **Server side retention** defaults to pruning `session` snapshots after
   14 days (`TABVERSED_RETENTION_DAYS`, 0 = keep forever).
5. **No third parties.** The extension talks to exactly one server, the one
   the user typed.

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
