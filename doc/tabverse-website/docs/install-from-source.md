---
sidebar_position: 6
sidebar_label: Install from Source
---

# Install from source

Tabverse is open source (MIT). If you want to run the code in this repository
rather than the released build - to try a change, to read along, or to build the
store package yourself - this page is the whole path from a clone to a working
extension in Chrome.

For the ordinary install, see [Get Started](./intro). This page assumes you can
run commands in a terminal.

## What you need

- **Chrome 140 or newer.** Tabverse is a Manifest V3 extension and uses
  `chrome.storage.session`, the side panel and Chrome's built-in AI.
- **Node.js 22 or newer** and **pnpm**. `pnpm-lock.yaml` is the source of truth;
  the repository does not use npm or yarn.
- **Git**, to get the code.

## Get the code

```sh
git clone https://github.com/liyu1981/tabverse.git
cd tabverse
pnpm install
```

## Build the extension

Two commands matter day to day:

```sh
pnpm run dev      # watch build into dist/, rebuilt on every save
pnpm run build    # one production bundle into dist/
```

Either way the output is a complete, loadable extension in `dist/` - manifest,
pages, assets, icons and locales. `pnpm run build` minifies and drops the
development affordances; use `pnpm run dev` while working.

`pnpm run build-store` produces the same production bundle as a zip at
`dist_store/tabverse.zip`, which is the file the Chrome Web Store dashboard
takes (and the file a release ships).

## Load it in Chrome

Chrome loads a **folder**, not a zip:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `dist/` folder in your clone.

Then click the Tabverse `T` in the toolbar; if it is not pinned, use the
extensions puzzle-piece menu.

With `pnpm run dev` running, the files in `dist/` change as you edit. Chrome
does not reload them by itself:

- **UI changes** (React pages, CSS) show up after you reload the page - the
  popup or the manager tab - not the whole extension.
- **Service worker or manifest changes** need the reload arrow on the Tabverse
  card in `chrome://extensions`.

Reloading that way keeps the extension id, so your tabverses, notes and settings
survive the loop.

`pnpm run dev` keeps running until you stop it; do not leave it in a terminal
you have forgotten about.

## A note on extension ids and data

An unpacked build loaded from `dist/` gets an id derived from its folder path,
which is not the id of the Chrome Web Store build. Everything Tabverse stores -
tabverses, notes, todos, bookmarks, closed-tab history - lives in IndexedDB,
which is per extension id. So a development build starts empty and does not see
the data of a store install, and vice versa.

Two practical consequences:

- Use one folder for your build and keep it. Moving or renaming the clone gives
  the unpacked extension a new id - a fresh, empty profile.
- A `.tabverse` file exported from one install imports into the other
  (popup → **Import**), which is the way to carry data across.

## Before sending a change

```sh
pnpm test               # vitest with coverage
pnpm run typecheck      # tsc --noEmit
pnpm run lint:check     # biome lint
pnpm run format:check   # biome format
```

The repository also has a Go server for optional sync; its suite lives in
`server/` (`go vet ./...`, `go test -race ./...`).

## Where to read next

- [Architecture](https://github.com/liyu1981/tabverse/blob/main/ARCHITECTURE.md) -
  how the extension and the server fit together.
- [Design decisions](https://github.com/liyu1981/tabverse/tree/main/adr) - the
  ADRs behind them.
- [Repository README](https://github.com/liyu1981/tabverse#readme) - the other
  scripts (the server console, the docs build, version bumps).
- [Self-host a server](./self-host-server) - if you also want sync.
