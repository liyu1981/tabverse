# Chrome Web Store submission notes

Store assets (screenshots) live next to this file. This document holds the
text and the answers the developer dashboard asks for, so a release does not
have to rediscover them. Privacy policy source:
`doc/tabverse-website/src/pages/privacy.md` (published at
`https://liyu1981.github.io/tabverse/privacy`).

## Single purpose

> Manages browser tabs: saves/restores groups of tabs, and stores related
> user notes, todos and bookmarks.

All requested permissions below exist to serve that one purpose.

## Permission justifications

| Permission | Why it is needed |
|---|---|
| `tabs` | Read tab URLs/titles to save a tab group; detect and focus the Tabverse manager tab; restore tabs. Without it the extension cannot know what it is saving. |
| `activeTab` | Capture a screenshot of the active tab when the user saves it. |
| `scripting` | Run one small function in a page the user clicked, **on demand**, to read that page's rendered content for the page actions (view as Markdown, summarize into a note, attach to the AI chat). There is **no content script** and nothing runs on page load. |
| `storage` | Persist sync configuration, the sync cursor and the offline mutation queue (`chrome.storage.local`); `chrome.storage.session` for shared state. Required for the optional sync feature. |
| `unlimitedStorage` | Local IndexedDB cache of saved tab groups grows unbounded; the default 10 MB quota is far too small for a tab archive. |
| `idle` | Run the local database audit when the browser is idle instead of while the user is working. |
| `alarms` | Schedule the optional periodic sync and background work; service workers are killed by Chrome, so `setTimeout` cannot be relied on. |
| `host_permissions: <all_urls>` | Read page favicons and capture screenshots of arbitrary pages the user is saving, and - **only when the user clicks a tab's page-actions lightbulb** - read that page's rendered content for the page actions. No content script is injected; page reading is a one-off `chrome.scripting.executeScript` on the tab that was clicked. |
| `externally_connectable: https://tabversed.liyu1981.xyz/*` | Lets Tabverse's **own** server's pairing page hand this extension its device token when the user approves a one-click connection (ADR 0020). No other origin can send it a message; a token is accepted only when it answers a pairing *this device started* (message type, sender origin, single-use nonce) and it is never rendered by the page. |

## Data collection & use disclosures

Consistent with `adr/0002-privacy-posture.md`:

- **Local-only by default.** No data leaves the device until the user
  explicitly pairs a device with a sync server in the settings dialog. If that
  server has accounts enabled, the *web console* can be signed into with a
  single-use email link or a configured social provider; the extension itself
  never signs in and never holds a password or a session cookie.
- **A page's content is read only when the user asks, and never leaves the
  device.** The page-actions lightbulb (view as Markdown, summarize into a note,
  attach to the AI chat) reads the clicked tab's rendered content on demand and
  hands it to Chrome's built-in model in the same browser. Nothing is read in
  the background, nothing is read from a page the user did not click, and no
  page content is sent to us or to any server. A summary the user keeps is an
  ordinary note, which syncs only if the user has sync on.
- **Email address, only if the operator enabled console accounts.** It is used
  to send the sign-in link, stored on the user's own server, never sent
  elsewhere. Without accounts the extension collects no email address at all.
- **When sync is enabled**, the user chooses the server (self-hosted
  `tabversed` by default). The extension sends: tab URLs and titles, saved
  tab groups, notes, todos and bookmarks. Setting up the connection sends the
  data already on the device by default, with the count shown first and a box
  to untick; unticked, nothing is sent until the user changes something. (Browser session snapshots were
  collected by 0.5.x and are no longer sent; the server still prunes any that
  an older paired build uploaded.)
- **Not sold, not shared** with third parties; the extension talks to exactly
  one server, the one the user typed.
- **Retention:** server-side pruning of `session` records after 14 days by
  default (`TABVERSED_RETENTION_DAYS`, configurable, 0 = keep forever). No
  current build sends them; the window exists for older paired clients.
- **No analytics, no advertising, no tracking, no remote code.**
- Data is stored in transit over HTTPS/WSS; at rest it is a SQLite file on
  the server the user operates.

Answers to give in the dashboard:

| Question | Answer |
|---|---|
| Does this item collect user content? | **Yes — only when the user enables sync** (tab URLs/titles, notes, todos, bookmarks), stored on the sync server the user chose: one they run themselves, or Tabverse's own server (tabversed.liyu1981.xyz) with the one-click connection. Nothing is sent until sync is set up. |
| Does it collect browsing history? | **Yes — only when the user enables sync**, for the purpose of restoring tab groups. Never sold or shared. |
| Does it collect personally identifiable information? | No. The extension itself collects no accounts, emails or names beyond a self-chosen device label. A sync server you pair with may have console accounts; you create and sign into those on that server, and the address is stored there, not sent to us. |
| Is it used for analytics/advertising? | No. |

## Remote code

None. All code ships inside the package (`dist/`), all CSS/fonts are bundled
at build time from npm dependencies, and the manifest CSP forbids remote
scripts. The only network call is the sync server the user connected to; the
extension additionally *receives* a single message from its own pairing page
while a pairing is in progress (see `externally_connectable` above).

## Releasing

A release is a tag ([adr/0034](../adr/0034-releases-are-tags.md)).
`.github/workflows/release.yml` does the rest: it runs the CI gates, attaches the
store package to a GitHub release, and submits that package to the Chrome Web
Store for review.

```sh
node tools/version_update 0.7.3   # package.json and src/global.ts
pnpm run format:check             # the bump touches two formatted files
git commit -am "Version 0.7.3"
git tag v0.7.3
git push origin main --tags
```

The workflow refuses to build unless the tag, `package.json` and
`src/global.ts` agree, and `tools/cwsUpload.mjs` refuses to upload a version the
store already has - a version number cannot be used twice, so a failed
submission is a new patch version, not a re-run.

Rehearse a release, or check the credentials, without releasing anything:

```sh
node tools/version_update 0.7.3   # rehearse the version you are about to cut
git commit -am "Version 0.7.3"
gh workflow run release.yml -f dry_run=true
```

That runs the whole pipeline against the commit you dispatched - the only way
to rehearse code that has not been tagged yet. It builds, checks the archive,
exchanges the store token, prints the version the store currently has and stops
before the upload.

Bump first: the version guard runs in a dry run too, so rehearsing at the
version already on the store stops there with "the store already has 0.7.2
published". That message is itself proof that the token, the publisher id and
the extension id are all right - the run got as far as asking the store.

Passing `-f tag=v0.7.3` instead releases *that tag's* tree, which is what a
retry does; a dispatch with no tag and no dry run is refused.

A failed store step can be retried by re-running the workflow for the same tag:
the GitHub release is updated in place, and the submission is attempted again.
If the upload itself had already succeeded, the tool stops and says so.

The release notes are GitHub's generated list of merged changes; edit them in
the release if a version needs prose to explain itself.

### One-time setup: store credentials

The Chrome Web Store API has no account-less access; the workflow publishes as
an OAuth client owned by the publisher account.

1. **Google Cloud project**: enable the *Chrome Web Store API*, then configure
   an OAuth consent screen (External, app name, support email, developer
   contact) and add the publisher address as a test user.
2. **Publish the consent screen** when it works ("Publish app"). While it stays
   in *Testing*, Google expires refresh tokens after 7 days, and the next
   release then fails with `invalid_grant` for no visible reason.
3. **OAuth client**: *Create credentials* → *OAuth client ID* → application type
   **Web application**, with `https://developers.google.com/oauthplayground` as
   an authorized redirect URI. Keep the client id and secret.
4. **Refresh token**: at the [OAuth 2.0
   Playground](https://developers.google.com/oauthplayground), use your own
   credentials, authorize the scope
   `https://www.googleapis.com/auth/chromewebstore`, sign in **as the publisher
   account** (it owns the item; the Cloud project may belong to anyone), then
   *Exchange authorization code for tokens* and copy the refresh token.
5. **Publisher id**: *Publisher* → *Settings* in the [developer
   dashboard](https://chrome.google.com/webstore/devconsole), where it is shown
   as *Publisher ID*.
6. **Repository settings**: add the secrets `CWS_CLIENT_ID`,
   `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and the variable
   `CWS_PUBLISHER_ID` (Settings → Secrets and variables → Actions). The
   extension id defaults to the published item; a fork overrides it with the
   variable `CWS_EXTENSION_ID`.

Publishing over the API also requires **2-step verification** on the publisher
account.

If the submission step fails with `missing CWS_PUBLISHER_ID`, check that it was
added on the repository settings' **Variables** tab and not the *Secrets* one:
the workflow reads it as `vars.CWS_PUBLISHER_ID`, and a secret of the same name
is simply not visible there. The job log prints both, so an empty
`CWS_PUBLISHER_ID:` line next to masked `CWS_*` values is this exact mistake.

## Manual steps before a release

- Re-check the disclosure answers above if sync or page reading changed.
- The listing itself - name, description, screenshots, privacy answers,
  visibility - is dashboard work: the API cannot change it.
