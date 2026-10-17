<p align="center">
  <img src="https://raw.githubusercontent.com/liyu1981/tabverse/main/doc/tabverse-website/static/img/tabverse-feature-1.png" alt="Tabverse's sidebar: the current tabverse, saved tabverses and omni search" width="480" style="box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18); border-radius: 12px;">
</p>

<h1 align="center">Tabverse</h1>

<p align="center"><em>An opinionated way of managing tabs in Chrome.</em></p>

Tabverse turns a window full of related tabs into a named workspace you can put
down and pick up again. When a piece of work is done - or you just need a break
- close the window without losing the thread.

## What it does

- **Tabverses.** A tabverse is one window's work: its tabs and tab groups, saved
  under a name and restored later.
- **The things that go with it.** Notes, todos, bookmarks, an AI chat, and
  the tabs you closed hang off the tabverse instead of being lost in a scratch
  tab. Pin a tool to the top, focus it, and the layout is remembered.
- **On-device AI.** Where Chrome ships its built-in model: chat about a page you
  attach, summarize a page into a note, suggest a name - all on this device. A
  page can also be viewed as Markdown and copied without any model at all.
- **Omni search.** Find a tab, note or bookmark across every tabverse you have.
- **Local first.** Everything lives in your browser profile, in IndexedDB. No
  account, no network, no telemetry.
- **Optional sync.** Pair with a server to keep several browsers in step.
  Nothing leaves the device until you set it up.

The [user manual](https://liyu1981.github.io/tabverse/docs/intro) walks through
every tool in detail.

## Install

Chrome 140 or newer, Manifest V3.

- **Chrome Web Store** - the listing is in review; the button on the
  [website](https://liyu1981.github.io/tabverse/) turns on when it is live.
- **From a release** - download `tabverse.zip` from
  [GitHub releases](https://github.com/liyu1981/tabverse/releases) and extract it
  to a folder. Keep that folder: extracting each version into the same one keeps
  the extension id, and your settings, stable. Then open `chrome://extensions`,
  turn on **Developer mode**, and **Load unpacked** that folder.

## Documentation

- [**User manual**](https://liyu1981.github.io/tabverse/docs/intro) - install,
  tabverses, notes, todos, bookmarks, history, omni search, sync.
- [**Self-host a server**](https://liyu1981.github.io/tabverse/docs/self-host-server)
  - run `tabversed` for your own sync.
- [**Server console**](https://liyu1981.github.io/tabverse/docs/server-console)
  - the account and data surface of a deployment.
- [Privacy policy](https://liyu1981.github.io/tabverse/privacy) and
  [user agreement](https://liyu1981.github.io/tabverse/terms).

## Sync (optional)

The extension pairs with any `tabversed` server
([adr/0010](adr/0010-extension-may-talk-to-any-server.md)):

- **The official server** -
  [tabversed.liyu1981.xyz](https://tabversed.liyu1981.xyz/console), the
  deployment the extension's one-click setup points at.
- **Your own** - the server is a single Go binary on SQLite. Start at the
  [self-hosting guide](https://liyu1981.github.io/tabverse/docs/self-host-server),
  or read [`server/README.md`](server/README.md).

Either way, sync is opt-in per browser: it starts when you pair a device, and
the dialog shows how much data will be sent before anything is.

## Where your data lives

Tabverses and their tabs, notes, todos, bookmarks, closed-tab history and the
**tab previews** all live in IndexedDB in your browser profile.

The previews are the only cache: a picture of a live tab, keyed by its Chrome
tab id, swept when the tab closes and never sent to a server
([adr/0016](adr/0016-tab-previews-are-a-cache.md)). Losing them costs a few
missing thumbnails and nothing else.

Nothing is sent anywhere until you pair a server, and then only your content.
The [privacy policy](https://liyu1981.github.io/tabverse/privacy) spells it out.

## Development

```sh
pnpm install            # pnpm-lock.yaml is the source of truth
pnpm run develop        # watch build of the extension into dist/
pnpm run build          # production bundle
pnpm run build-store    # production bundle + dist_store/tabverse.zip
```

Load `dist/` as an unpacked extension at `chrome://extensions`; the watch build
refreshes it (reload the service worker from the extensions page after
background changes).

The sync server's console is a second Vite project, at `server/ui`, built into
the Go binary rather than into `dist/`:

```sh
pnpm run ui:dev         # console at http://localhost:5174/console/, proxying to a server on :8223
pnpm run ui:build       # console -> server/internal/webui/dist (embedded, never committed)
```

```sh
pnpm test               # vitest + coverage
pnpm run typecheck      # tsc --noEmit
pnpm run lint:check     # biome lint
pnpm run format:check   # biome format
```

Version bumps happen in one place: a `pnpm version`-style edit of
`package.json` - the manifest version is injected at build time, and
`tools/version_update` keeps `src/global.ts`'s UI version string in sync.

## Project

- [Architecture](ARCHITECTURE.md) - how the extension and the server fit
  together.
- [Design decisions](adr/) - the ADRs behind both.
- [Discussions](https://github.com/liyu1981/tabverse/discussions) - feedback and
  questions.
- [MIT licensed](LICENSE.txt).
