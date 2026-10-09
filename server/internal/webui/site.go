// The site this server answers with outside its own interface: the docs in an
// official build, a page that sends you to the console otherwise (adr/0024).
//
// Which one it is comes from what is embedded next to this file, not from a
// build tag or a runtime flag:
//
//	docs/  the built documentation site, populated by `officialserver=1` (see
//	       tools/embedsite.sh) and empty - a tracked .gitkeep and nothing else -
//	       in every other build;
//	home/  the tracked redirect page, always here, so a binary built on a fresh
//	       clone still answers / with something that works.
//
// So the decision is a stat at startup, the flag lives entirely in the build,
// and `go build`, `go vet` and `go test` need no arguments either way. The one
// hazard is a stale docs/ directory left by an official build: every default
// build clears it first, which is what makes this deterministic.
package webui

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed all:home all:docs
var site embed.FS

// sitePrefix is what the home page redirects to. It is spelled out rather than
// taken from Mount so that the redirect cannot be silently broken by a rename
// of the mount - the two are checked against each other in the tests.
const sitePrefix = "/console"

// SiteHandler serves the URL space that is not the console's and not an API's:
// everything the router sends to "/" lands here, because the routes that matter
// are all registered above it.
func SiteHandler() http.Handler {
	if HasDocs() {
		return docsSite(subMust(site, "docs"))
	}
	// The redirect page is tracked, so this is only reachable if the embed
	// directive above is broken - i.e. at build time, not at runtime.
	return homeSite(subMust(site, "home"))
}

// HasDocs reports whether this binary carries the documentation site - whether
// there is anything at "/" worth linking to rather than the redirect page
// (adr/0024).
//
// The console asks for this on /console/api/v1/console/me, which is how the
// bar's link back to "/" knows whether to exist: a default build would send a
// person to a page whose only job is to send them straight back.
func HasDocs() bool {
	_, err := fs.Stat(site, "docs/index.html")
	return err == nil
}

// homeSite answers every path with one page: a refresh straight to the console.
//
// Every path, not just "/": in a build with no docs there is nothing else to
// serve, and a person who follows an old link should land on the console
// rather than on a 404 that says the server is broken.
func homeSite(home fs.FS) http.Handler {
	page, err := fs.ReadFile(home, "index.html")
	if err != nil {
		// The file is tracked and `//go:embed all:home` fails the build without
		// it, so this cannot happen at runtime.
		panic("webui: home/index.html is not embedded: " + err.Error())
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSiteHeaders(w)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		// The page is a redirect: caching it would mean a deploy that moved the
		// console still sending people to wherever the cached copy pointed.
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(page)
	})
}

// docsSite serves the built documentation site, with its own 404 page.
//
// There is deliberately no Content-Security-Policy here. The console's handler
// sets a very tight one, and the reasons that works there - no third party
// code, no inline script, an authenticated surface - do not transfer to a
// Docusaurus build, which boots from an inline script. This content is served
// exactly as GitHub Pages serves it today: static files from this repository,
// built into the binary, with nosniff and a no-referrer policy on top.
func docsSite(docs fs.FS) http.Handler {
	files := http.FileServer(http.FS(docs))
	// The site's own not-found page, so a typo in a link still looks like the
	// site. Served with a 404 status: a soft 404 is how a monitoring check
	// learns nothing.
	notFound, _ := fs.ReadFile(docs, "404.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSiteHeaders(w)
		if !fileExists(docs, urlPath(r.URL.Path)) {
			w.Header().Set("Cache-Control", "no-cache")
			if notFound == nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write(notFound)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			// Docusaurus hashes its bundle names (styles.9d5257e0.css), so the
			// bytes at a URL never change - the same bargain the console's own
			// assets get.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

// setSiteHeaders is the pair every site response carries. The console's own
// CSP and Referrer-Policy are set by Handler; see docsSite for why this one
// does not set them the same way.
func setSiteHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	// The one part of the console's policy that costs a Docusaurus nothing:
	// nobody frames this page, and no page gets to rewrite its base URL.
	w.Header().Set("Content-Security-Policy",
		"frame-ancestors 'none'; base-uri 'none'")
}

// urlPath turns a request path into a path inside the embedded filesystem.
// path.Clean drops any `..` before it gets near an fs.FS (embed rejects those
// anyway; this keeps the behaviour the same if the FS is ever something else),
// and an empty path is the site's index.
func urlPath(p string) string {
	clean := strings.TrimPrefix(path.Clean("/"+p), "/")
	if clean == "" {
		return "index.html"
	}
	return clean
}

// fileExists reports whether name is in fsys and servable: a file, or a
// directory with an index page. A directory without one is deliberately *not*
// servable, because http.FileServer would answer it with a listing of the
// files in the binary.
func fileExists(fsys fs.FS, name string) bool {
	st, err := fs.Stat(fsys, name)
	if err != nil {
		return false
	}
	if !st.IsDir() {
		return true
	}
	_, err = fs.Stat(fsys, path.Join(name, "index.html"))
	return err == nil
}

// sub is fs.Sub with the ok, for a tree whose parts are not all there.
func sub(fsys fs.FS, dir string) (fs.FS, bool) {
	s, err := fs.Sub(fsys, dir)
	return s, err == nil
}

// subMust is sub for the part that is always embedded.
func subMust(fsys fs.FS, dir string) fs.FS {
	s, ok := sub(fsys, dir)
	if !ok {
		panic("webui: " + dir + " is not embedded")
	}
	return s
}
