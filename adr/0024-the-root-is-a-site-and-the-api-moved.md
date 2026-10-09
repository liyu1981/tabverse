# ADR 0024: the root is a site, and everything the app does lives under /console

Status: accepted (2026-10)

Supersedes decision 2 of
[ADR 0023](0023-the-console-has-its-own-prefix.md) (unknown root paths are a
404), the `?pair=1&ext=…` form of its decision 3 and the fragment reading of its
decision 4, and decision 2 of
[ADR 0020](0020-official-server-wizard-pairing.md) once more. ADR 0023's mount
itself - `/console`, its assets, `webui.Mount`, the `?from=` return target -
stands unchanged.

## Context

ADR 0023 gave the console a prefix of its own and left the rest of the URL space
to the API. Two things then had to be true at once and could not be.

**The official server wants to be a website.** `tabversed.liyu1981.xyz` is the
project's home as well as a server: the documentation should be what a person
finds at its root, not a redirect to a sign-in form. The self-hosted server
wants the opposite - there is no documentation to serve, and the root should
send an operator to their console. One binary cannot decide this at runtime
without carrying both, and a deployment that has to be told which one it is
would be a deployment that can be told wrong.

**The API being at `/api` made the root contested.** The console shell was
registered under `/console/` and the site would be registered at `/`, so an
unknown endpoint - a typo, a version this server does not have - fell through to
the site and came back as HTML with a 200. That is the one answer an API client
cannot work with: the extension would report it as a malformed response instead
of as a 404. The API had to belong to the same prefix as everything else the
app serves, so that "not an endpoint" and "not a page" stop being the same
question.

## Decisions

1. **The URL space has three owners, and `/console` owns two of them.**

   | path | what it is |
   |---|---|
   | `/console`, `/console/assets/*`, `/console/<client route>` | the console page |
   | `/console/api/v1/*` | the sync, entity, search, admin and console API |
   | `/console/pair?ext=…&nonce=…` | the pairing page (a client side route) |
   | `/auth/*` | the account library's login routes, unchanged |
   | `/healthz` | the probe |
   | `/` and everything else | the site (decision 3) |

   Every endpoint that used to be `/api/v1/…` is now `/console/api/v1/…` - in
   the router, in both clients (`server/ui/data/api.ts`,
   `src/data/repo/serverApi.ts`), in `api/openapi.yaml` and in the curl
   examples. The path in an earlier ADR reads with that prefix added.

2. **An endpoint nobody claimed answers like an endpoint.**
   `mux.Handle(webui.Mount+"/api/", …)` is registered between the routes and
   the console shell: longer prefix than `/console/`, so it outranks the shell,
   and never a route that names its full path. A miss under `/console/api/` is a
   JSON 404; a miss anywhere else under `/console/` is still the page, because
   those are the console's own client side routes.

3. **The site at `/` is whichever one this build embedded, decided by one build
   variable.** `officialserver=1` is read in exactly two places:
   `tools/embedsite.sh`, which builds the documentation into
   `server/internal/webui/docs/` (and clears it first, so a default build after
   an official one cannot ship it by accident), and `docusaurus.config.js`,
   which switches `baseUrl` (`/` vs `/tabverse/`), `url` (the deployment's
   `TABVERSED_PUBLIC_URL` vs GitHub Pages) and adds the **Login** navbar item
   after *User Manual* - as a plain `<a href="/console/" target="_self">`,
   because the console is not one of the site's routes: a link Docusaurus
   recognises as internal is followed *inside* the site, and that renders the
   site's own 404. `pathname://` is what tells it not to take the link over,
   and the trailing slash is what the console is asked for. The Go side does not
   know the flag exists: it embeds
   `home/` (a tracked redirect page, always present) and `docs/` (present only
   in an official build) and stats them at startup. So `go build`, `go vet` and
   `go test ./...` need no arguments either way, and the same test file checks
   the handler's logic against a fake tree and the real one only when it is
   there.

   In an official build a path the documentation does not have is served as the
   site's own `404.html` with a 404 status; in a default build every path is the
   one redirect page, because there is nothing else to serve.

4. **The pairing page is a path, not a marker key.**
   `/console/pair?ext=…&nonce=…` is what the extension opens. The path says
   which page this is, so the query needs no `pair=1` to say it twice, the
   console's own state (`user`, `tab`, `tabspace`, `view`, `q`) lives in the
   query of `/console` and cannot be mistaken for it, and nothing reads the
   fragment any more - old extension builds are not carried across, they update.

5. **The console's CSP stays where it is; the site gets a different one.** The
   console is an authenticated surface drawn from its own bundle, so its policy
   stays `default-src 'none'` plus what Blueprint needs. A Docusaurus build
   boots from an inline script, so a policy strict enough to matter would break
   it; the site is served as GitHub Pages serves it today - static files from
   this repository, `nosniff`, `no-referrer`, and `frame-ancestors 'none' +
   base-uri 'none'`, which cost the site nothing.

## Consequences

- One binary serves both audiences. The official flavour is built and tested by
  its own CI job (`server-official`), because nothing else builds it and an
  untested flavour is a flavour that has quietly stopped working.
- The extension and the console are the only API clients, and both are in this
  repository: an endpoint path changed in one commit with the router that serves
  it. A client outside this repository would have needed a version negotiation
  this one does not have.
- Which leaves the skew that a path change always has: a browser whose extension
  updated before its self-hosted server was restarted 404s on sync until the
  server is updated with it. The dialog shows the refusal rather than breaking,
  and the window is one deployment of two halves that ship from here.
- `pnpm run build-doc` (GitHub Pages) and `officialserver=1 pnpm run
  site:prepare` (the binary) are two builds of one configuration;
  `tools/builddoc.sh` unsets the flag so a shell used for one cannot produce the
  other's site for the wrong host.
- The two halves link to each other, each on the other's terms. The docs'
  **Login** is a plain anchor to `/console/` (decision 3) - a full page load,
  because there is no router here to perform it. The console's top bar offers
  **tabverse** back at `/`, but only when the server says there is something there:
  `handleConsoleMe` carries `docs: webui.HasDocs()`, since in a default build
  `/` is the page whose only job is to redirect to the console, and a link
  that comes straight back is worse than no link.
- Old links pay for the move: `/#user=…` lands on the site rather than on an
  account, and `https://host/api/v1/…` lands on the documentation's 404. Neither
  is a client that cannot be updated - the first is a bookmark and the second
  was never a public contract.
