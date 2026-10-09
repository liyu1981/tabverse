// Package webui serves the tabversed operator console: a small read only
// browser for what the server stores, plus the account and token management
// screen (adr/0009).
//
// The console is a Vite/React application under server/ui (adr/0018) whose
// build output lands in dist/ here and is embedded in the binary, so a
// deployment stays a single file: there is no static directory to ship next to
// it, and the console can never drift from the API it talks to.
//
// dist/ is generated (`pnpm run ui:build`) and not committed, because a
// generated tree in version control is a merge hazard nobody reads. The tracked
// .gitkeep keeps the directory present so this file compiles on a fresh clone;
// when it is still empty the handler serves a page that says which command to
// run rather than a blank one.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var dist embed.FS

// Mount is the URL prefix the console is served under, and the one every part
// of it has to agree on: the asset URLs the built shell names, the route the
// router registers, and the return target a sign-in comes back to (`?from=`).
//
// It is a constant rather than a setting because it is not a deployment's
// choice: the console is this server's own page, and a prefix that could be
// configured would be three places to keep in step for no benefit (adr/0023).
const Mount = "/console"

// notBuilt is what the console answers with before it has been built. A binary
// built without its UI is not a broken deployment - the API works and nothing
// is lost - so this is a page, not an error, and it names the command.
const notBuilt = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>tabversed console</title>
<link rel="icon" href="data:,">
<style>body{font:14px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#353d4d;
margin:0;padding:8vh 16px}main{max-width:520px;margin:0 auto;background:#fff;
border:1px solid #e8e9ec;border-radius:18px;padding:24px}
h1{color:#54617a}code{background:#f0f1f2;padding:2px 6px;border-radius:4px}
</style></head>
<body><main><h1>The console has not been built</h1>
<p>This binary was built without its web console. Everything else - the sync
API, pairing, the accounts - works; only this page is missing.</p>
<p>Build the console and run the binary again:</p>
<p><code>pnpm run ui:build</code></p></main></body></html>`

// Handler serves the console's built files.
//
// The console authenticates every API call with the session cookie the server
// set (adr/0012); the assets themselves are public (a sign-in screen has to be
// loadable to exist), and nothing under dist/ contains data.
//
// `frameAncestors` is the CSP `frame-ancestors` source list: who may put the
// console in an iframe. It comes from configuration (TABVERSED_FRAME_ANCESTORS,
// adr/0025) because the Tabverse extension shows the console in a side panel -
// an embedder policy is a deployment's decision, not this package's. An empty
// value refuses all framing, which is the safe answer for a caller that does
// not think about it.
//
// The embed root is the dist/ directory, so the URL space is rewritten on the
// way in: the page lives at /console, its files at /console/assets/<name>-<hash>.<ext>
// - the space ADR 0009 established, now under the console's own prefix so the
// API's URL space and the page's do not overlap (adr/0023).
func Handler(frameAncestors string) http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		// Only reachable if the embed directive above is broken, i.e. at build
		// time, not at runtime.
		panic(err)
	}
	// A binary built without the UI: the shell answers with the instructions
	// and everything else 404s, which is the state a fresh clone is in until
	// `pnpm run ui:build` has run once.
	_, builtErr := fs.Stat(sub, "index.html")
	files := http.FileServer(http.FS(sub))

	if strings.TrimSpace(frameAncestors) == "" {
		frameAncestors = "'none'"
	}
	// The console loads no third party code and talks only to its own origin,
	// so the policy can be this tight. 'unsafe-inline' is needed for the styles
	// Blueprint sets from JS (a Popover's position); scripts stay external and
	// same-origin. `frame-ancestors` is the one directive a deployment sets.
	policy := "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' data: https: http:; connect-src 'self'; base-uri 'none'; " +
		"form-action 'none'; frame-ancestors " + frameAncestors

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", policy)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")

		clone := r.Clone(r.Context())
		// The URL space is `/console` for the shell and `/console/assets/<name>`
		// for its files, while the bundle's root holds the shell and its files
		// side by side - so the mount is stripped first, then the assets prefix,
		// leaving the path the bundle's own root is addressed by.
		trimmed := strings.TrimPrefix(r.URL.Path, Mount)
		clone.URL.Path = strings.TrimPrefix(trimmed, "/")
		clone.URL.Path = strings.TrimPrefix(clone.URL.Path, "assets/")
		name := path.Clean(clone.URL.Path)

		if builtErr != nil {
			w.Header().Set("Cache-Control", "no-store")
			if strings.HasPrefix(trimmed, "/assets/") {
				http.NotFound(w, clone)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(notBuilt))
			return
		}

		// isAsset remembers which side of the rewrite the request came from: a
		// missing file under /console/assets/ is a broken build and has to look
		// broken, while any other unknown path is a client side route and gets
		// the shell.
		isAsset := strings.HasPrefix(trimmed, "/assets/")
		if name != "index.html" {
			if _, err := fs.Stat(sub, name); err != nil {
				if isAsset {
					http.NotFound(w, clone)
					return
				}
				// The file server serves the shell for "/", and asks for
				// "/index.html" to be redirected - so the fallback is "/" and
				// never the file name.
				clone.URL.Path = "/"
				name = "."
				w.Header().Set("Cache-Control", "no-cache")
				files.ServeHTTP(w, clone)
				return
			}
		}

		if isAsset {
			// Every asset name carries a content hash, so a browser may keep one
			// forever. The shell may not be cached at all, or a deploy would
			// keep serving the old page pointing at files it no longer has.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, clone)
	})
}
