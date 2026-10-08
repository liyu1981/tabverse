# ADR 0023: the console lives at /console, and its parameters live in the query

Status: accepted (2026-10); decisions 2, 3 and 4 are superseded by
[ADR 0024](0024-the-root-is-a-site-and-the-api-moved.md) - the root became the
site, the API moved under `/console/api`, and the pairing request moved onto a
path of its own. The mount itself stands.

Supersedes the "page at `/`, files at `/assets/`" half of the URL space
established by [ADR 0009](0009-multi-tenant-and-server-console.md) and kept by
[ADR 0018](0018-console-is-a-vite-app.md), decision 6's *fragment* half, and
[ADR 0020](0020-official-server-wizard-pairing.md), decision 2. The workflows
those decisions protect - a bookmarked account, a pasted link, a pairing window
the extension opens - all stay; only where the state travels changes.

## Context

The console was served from `/`: it was the first thing the server answered
with, and every unknown path under it was the shell again, because "the console
is one page" and its client side routing owns whatever the API does not. The
page's state went into the URL fragment - `#user=…&tab=…&tabspace=…&view=…&q=…`
for the operator's bookmarks, `#pair=1&ext=…&nonce=…` for the pairing window -
and the fragment was chosen deliberately: it never reaches the server, so the
nonce stayed out of the request log.

Two things made that arrangement stop fitting.

**The page and the API share one URL space, and neither can be addressed
precisely.** A proxy rule, an access log line, a CSP report or an operator's
bookmarked health check all read `GET /` and get HTML back. There is no path
that says "this is the page" as opposed to "this is the server", no way to 404 a
typo without also 404ing the console, and the asset namespace (`/assets/`) sits
at the root next to things that are not the console's.

**The fragment means the server can never see the URL's state.** That is a
feature for a nonce and a nuisance for everything else: a sign-in round trip
comes back through `?from=`, which the server sets and the fragment cannot
travel in - hence the `sessionStorage` stash the pair view keeps, a second
mechanism for one fact. It also meant two routing conventions in one page,
which is one more than a reader has to hold.

## Decisions

1. **The console is mounted at `/console`.** `webui.Mount` is the one constant
   that names it: the router registers `webui.Mount` and `webui.Mount + "/"`,
   the built shell names its assets `/console/assets/<name>-<hash>.(js|css)`
   (Vite's `base`), the handler strips the prefix on the way into the embed,
   and `accounts.ConsoleURL` - the `?from=` every sign-in returns to - is the
   public URL plus the same prefix. One name, three places that cannot drift.
   The dev server serves from `/console/` too, so a page developed at
   `http://localhost:5174/console/` is the page production serves.

2. **`/` redirects to `/console`, and nothing else lives at the root.** *(Superseded
   by [ADR 0024](0024-the-root-is-a-site-and-the-api-moved.md), which put a site
   at the root instead - the documentation in an official build, this redirect
   page otherwise - and left a JSON 404 under `/console/api/` to say what a path
   is not.)* The
   redirect keeps the query (so `/?pair=1…` lands as `/console?pair=1…`) and a
   browser keeps the fragment the server never sees, which is what lets a
   window opened by an already installed extension pair after the move. Any
   other unknown path is a 404: the console's client side routes are the
   console's, under its prefix, and a server that answers every path with HTML
   is a server nobody can probe.

3. **The parameters are real HTTP parameters.** `readQuery`/`writeQuery`
   (`server/ui/data/queryRoute.ts`) read and rewrite the query, and
   `readPairRequest` reads the pairing request out of one - `?ext=…&nonce=…` on
   `/console/pair` since
   [ADR 0024](0024-the-root-is-a-site-and-the-api-moved.md); it was
   `?pair=1&ext=…` here. A rewrite carries every key it did not change, so the
   routing keys and the pairing request share the one query without either
   eating the other.

4. **A fragment is still read for the pair request, and only for that.**
   *(Superseded by
   [ADR 0024](0024-the-root-is-a-site-and-the-api-moved.md), which dropped the
   fragment read altogether: the pairing page is a path now, and old extension
   builds are not carried across.)* The
   server's `/` redirect hands an old `#pair=…` over unchanged, and a pairing
   that silently refused would be the most confusing day in the wizard. Nothing
   else reads or writes the fragment.

## Consequences

- The nonce is now in a request log. It was the one thing the fragment bought
  (ADR 0020, decision 2), and the price is bounded: the nonce is known to the
  server the window is opened against (the extension mints it and echoes it
  back), the pairing endpoint is authorised by the console's own session, and
  the log is the deployment's own. What it buys is a console whose whole URL is
  an ordinary URL - one that a proxy can route on, a log can be read in, and a
  redirect can carry.
- Sign-in links, social callbacks and the email template are unchanged: they
  were always under `/auth`, and only their return target moved.
- `TABVERSED_PUBLIC_URL` keeps meaning the server's address; the console is that
  plus `/console`, so an existing deployment changes nothing in its
  configuration.
- Old bookmarks at `/#user=…` land on `/console#user=…`, where the routing no
  longer looks. They are a redirect away from working again by re-saving the
  link; the pair request is the only state kept working across that gap (see
  decision 2), because it is the only one an unattended window depends on.
