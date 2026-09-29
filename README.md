# Tabverse

Tabverse is an opinioned way of managing tabs inside Chrome browser, as an
extension. Tabverse is a result after trying various tab manager extensions on
Chrome extension marketplace: many of them are really good but none of them is
ideal as I have imaged.

## Development

```sh
npm ci               # install (package-lock.json is the source of truth)
npm run develop      # vite build --watch, development bundle (includes dev pages)
```

Load `dist/` as an unpacked extension at `chrome://extensions`, then edit
sources; the watch build refreshes the extension (reload the service worker
from the extensions page after background changes).

```sh
npm run build        # production bundle -> dist/
npm run build-crx    # production bundle + dist_crx/tabverse.zip (store package)
npm test             # vitest + coverage
npm run typecheck    # tsc --noEmit
npm run lint:check   # eslint (flat config: eslint.config.mjs)
npm run format:check # biome
```

Version bumps happen in one place: `npm version`-style edit of
`package.json` — the manifest version is injected at build time and
`tools/version_update` keeps `src/global.ts`'s UI version string in sync.

The sync server lives in [`server/`](server/README.md), the architecture and
current status in [`ARCHITECTURE.md`](ARCHITECTURE.md), and the design
decisions in [`adr/`](adr/).
