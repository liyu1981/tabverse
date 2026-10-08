# Tabverse

Tabverse is an opinioned way of managing tabs inside Chrome browser, as an
extension. Tabverse is a result after trying various tab manager extensions on
Chrome extension marketplace: many of them are really good but none of them is
ideal as I have imaged.

## Development

```sh
pnpm install         # install (pnpm-lock.yaml is the source of truth)
pnpm run develop     # vite build --watch, development bundle (includes dev pages)
```

Load `dist/` as an unpacked extension at `chrome://extensions`, then edit
sources; the watch build refreshes the extension (reload the service worker
from the extensions page after background changes).

The sync server's console is a second Vite project, at `server/ui`, built into
the Go binary rather than into `dist/`:

```sh
pnpm run ui:dev      # the console at http://localhost:5174/console/, proxying /api to a server on :8223
pnpm run ui:build    # console -> server/internal/webui/dist (embedded, never committed)
```

```sh
pnpm run build        # production bundle -> dist/
pnpm run build-crx    # production bundle + dist_crx/tabverse.zip (store package)
pnpm test             # vitest + coverage
pnpm run typecheck    # tsc --noEmit
pnpm run lint:check   # biome lint
pnpm run format:check # biome format
```

Version bumps happen in one place: a `pnpm version`-style edit of
`package.json` — the manifest version is injected at build time and
`tools/version_update` keeps `src/global.ts`'s UI version string in sync.

## What is stored locally

Everything lives in IndexedDB in the browser profile: tabverses and their tabs,
notes, todos, bookmarks, closed-tab history, and the **tab previews** - the
thumbnails a tab card shows on hover.

The previews are the only part that is a *cache* rather than data. Each one is a
picture of a live tab (~30-80 kB), it is keyed by a chrome tab id, and it is
worth nothing once that tab is gone, so nothing in the product depends on one
existing: losing the table costs a few missing thumbnails and nothing else. The
service worker owns every delete of it, sweeping on a five-minute timer and the
moment a tab is closed (`adr/0016`). Previews are never sent to a sync server,
and they are the one table the schema upgrade is allowed to throw away.

The sync server lives in [`server/`](server/README.md), the architecture and
current status in [`ARCHITECTURE.md`](ARCHITECTURE.md), and the design
decisions in [`adr/`](adr/).
