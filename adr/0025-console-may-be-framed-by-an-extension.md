# ADR 0025: the console may be framed by a browser extension

Status: accepted (2026-10). Extends [ADR 0012](0012-accounts-are-for-the-console.md)
(the console's login is a session cookie) and [ADR 0021](0021-a-console-session-ends.md)
(how that session ends). Plan: none - the extension side is the side-panel
feature in `src/ui/manager/ServerConsole`.

## Context

The console's response carried a deliberate `frame-ancestors 'none'`
(`internal/webui`): the console is an authenticated operator surface, so
nothing was allowed to put it in an iframe and clickjack a signed-in person.

The Tabverse extension wants to show that console in a side panel next to
someone's tabverses. An extension page is a `chrome-extension://` document, a
different site from the server's, so the console is the *framed* side and
`frame-ancestors` is the directive that decides it. With `'none'` the browser
blocked the embed outright - the extension's own `frame-src` (which already
allows `http:` and `https:`) is only half of the permission; the framed page
has to agree too.

Two facts limit what agreeing costs:

- **The session cookie is `SameSite=Lax`.** It is not sent on requests made
  from a cross-site frame, so the embedded console is signed out until the
  person signs in inside the frame - and Lax cookies are not sent on a
  cross-site POST either, so that sign-in is unreliable. `frame-ancestors`
  being relaxed is necessary, not sufficient; the "open in a tab" affordance
  is the path that always carries the session.
- **The embedder is not a web page.** `frame-ancestors` defends against
  untrusted *web* content framing an authenticated page. An installed browser
  extension is not that: with host permissions it can already read the same
  cookies and rewrite requests, so allowing it to frame adds no capability it
  did not have.

## Decision

**The console's `frame-ancestors` is a setting, and its default admits browser
extensions only.**

1. `TABVERSED_FRAME_ANCESTORS` sets the source list. The default is
   `chrome-extension:`, which matches any extension and no web origin. `'none'`
   restores the old refusal; `chrome-extension://<id>` narrows it to one
   extension; `'self'` and named origins are accepted for an operator who
   embeds the console in something else. Unset or empty is the default, like
   every other variable this server reads - `'none'` is how an operator
   refuses, not an empty value.
2. **The value is refused if it contains a line break**, because it becomes a
   response header and nothing else in it is this code's business.
3. Only the console gets this. The documentation site keeps
   `frame-ancestors 'none'` (`internal/webui/site.go`): the extension embeds
   the console, and nothing needs to embed the site.
4. An empty value passed to the handler itself (a caller that did not
   configure anything) is `'none'`: the package refuses by default and only
   configuration opens it.

## Consequences

- **A redeploy is required for the embed to work.** The directive is served by
  the server, so an older `tabversed` binary still refuses the frame even
  though the extension's side panel is built for it. Nothing breaks while they
  disagree: the panel shows the console's own sign-in page (or the browser's
  refusal), and the panel's "open in a tab" button always works.
- **Any installed extension may frame the console**, which is why `'none'` and
  a single extension id are both one variable away. An operator on a shared
  machine who wants the old posture sets `'none'`.- **The clickjacking defence now excludes web pages rather than everything.**
  If a future console surface must not be framed even by an extension, it
  needs its own response (a separate route, or a frame-busting check on the
  embeds that must not be allowed), not a change to this default.
- **Signing in inside the frame is not promised.** The session cookie's
  `SameSite=Lax` is what a console session has been since ADR 0012/0021, and
  changing it to `None` would be a security decision of its own (it affects
  every deployment, not just embedders). The extension therefore treats the
  frame as a convenience and the tab as the working path.
