# Chrome Web Store submission notes

Store assets (screenshots) live next to this file. This document holds the
text and the answers the developer dashboard asks for, so a release does not
have to rediscover them. Privacy policy source:
`doc/tabverse-website/src/pages/privacy.md` (published at
`https://tabverse.github.io/tabverse/privacy`).

## Single purpose

> Manages browser tabs: saves/restores groups of tabs, and stores related
> user notes, todos and bookmarks.

All requested permissions below exist to serve that one purpose.

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `tabs` | Read tab URLs/titles to save a tab group; detect and focus the Tabverse manager tab; restore tabs. Without it the extension cannot know what it is saving. |
| `activeTab` | Capture a screenshot of the active tab when the user saves it. |
| `storage` | Persist sync configuration, the sync cursor and the offline mutation queue (`chrome.storage.local`); `chrome.storage.session` for shared state. Required for the optional sync feature. |
| `unlimitedStorage` | Local IndexedDB cache of saved tab groups/sessions grows unbounded; the default 10 MB quota is far too small for a tab archive. |
| `idle` | Run the local database audit when the browser is idle instead of while the user is working. |
| `alarms` | Schedule the optional periodic sync and background work; service workers are killed by Chrome, so `setTimeout` cannot be relied on. |
| `host_permissions: <all_urls>` | Read page favicons and capture screenshots of arbitrary pages the user is saving. No page content is read or injected; there are **no content scripts**. |

## Data collection & use disclosures

Consistent with `adr/0002-privacy-posture.md`:

- **Local-only by default.** No data leaves the device until the user
  explicitly pairs a device with a sync server in the settings dialog.
- **When sync is enabled**, the user chooses the server (self-hosted
  `tabversed` by default). The extension sends: tab URLs and titles, saved
  tab groups, notes, todos, bookmarks and session snapshots.
- **Not sold, not shared** with third parties; the extension talks to exactly
  one server, the one the user typed.
- **Retention:** server-side pruning of session snapshots after 14 days by
  default (`TABVERSED_RETENTION_DAYS`, configurable, 0 = keep forever).
- **No analytics, no advertising, no tracking, no remote code.**
- Data is stored in transit over HTTPS/WSS; at rest it is a SQLite file on
  the server the user operates.

Answers to give in the dashboard:

| Question | Answer |
|---|---|
| Does this item collect user content? | **Yes — only when the user enables sync** (tab URLs/titles, notes, todos, bookmarks, session snapshots), stored on a server the user controls. |
| Does it collect browsing history? | **Yes — only when the user enables sync**, for the purpose of restoring tab groups. Never sold or shared. |
| Does it collect personally identifiable information? | No. There are no accounts, emails or names beyond a self-chosen device label. |
| Is it used for analytics/advertising? | No. |

## Remote code

None. All code ships inside the package (`dist/`), all CSS/fonts are bundled
at build time from npm dependencies, and the manifest CSP forbids remote
scripts. The only network calls are the user-configured sync server and the
optional Dropbox API (user-supplied token).

## Release checklist

1. `npm version <x.y.z>` then `node tools/version_update <x.y.z>` (updates
   `src/global.ts`; the manifest version is injected from `package.json`).
2. `npm ci && npm run typecheck && npm run lint:check && npm run format:check && npm test`
3. `npm run build-crx` → upload `dist_crx/tabverse.zip`.
4. Re-check the disclosure answers above if sync behaviour changed.
