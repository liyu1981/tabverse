// Package webui serves the tabversed operator console: a small read only
// browser for what the server stores, plus the account and token management
// screen (adr/0009).
//
// The assets are embedded in the binary (go:embed) so a deployment stays a
// single file: there is no static directory to ship next to it, and the console
// can never drift from the API it talks to. There is no build step - the three
// files under assets/ are the whole thing, hand written vanilla JS.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed assets
var assets embed.FS

// Handler serves the console's static files.
//
// The console authenticates every API call with the admin token, which the
// page keeps in localStorage; the assets themselves are public (a login screen
// has to be loadable to exist), and nothing under assets/ contains data.
//
// The embed root is the package's assets/ directory, so the URL space is
// rewritten on the way in: the page lives at /, its two files at
// /assets/console.{css,js}.
func Handler() http.Handler {
	sub, err := fs.Sub(assets, "assets")
	if err != nil {
		// Only reachable if the embed directive above is broken, i.e. at build
		// time, not at runtime.
		panic(err)
	}
	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The console loads no third party code and talks only to its own
		// origin, so the policy can be this tight. 'unsafe-inline' is needed
		// for the styles the page sets from JS (entity badges, the row
		// highlight); scripts stay external and same-origin.
		w.Header().Set("Content-Security-Policy",
			"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: https: http:; connect-src 'self'; base-uri 'none'; "+
				"form-action 'none'; frame-ancestors 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")

		r = r.Clone(r.Context())
		switch {
		case strings.HasPrefix(r.URL.Path, "/assets/"):
			r.URL.Path = strings.TrimPrefix(r.URL.Path, "/assets")
		default:
			// A console is a single page app: unknown paths are client side
			// routes, so they get the shell rather than a 404. A missing file
			// under /assets/ is still a 404, because a broken asset should
			// look broken.
			if _, err := fs.Stat(sub, strings.TrimPrefix(r.URL.Path, "/")); err != nil {
				r.URL.Path = "/"
			}
		}
		files.ServeHTTP(w, r)
	})
}
