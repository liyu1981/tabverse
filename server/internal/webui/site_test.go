package webui

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

// What the server answers with outside /console (adr/0024): the documentation
// in an official build, one redirect page otherwise. The two are decided by
// what is embedded, so these tests check the page that is always here, the
// handler that serves either one, and the docs only when they are embedded -
// which is what lets the same test file pass in a default build and do real
// work in the official one.

// TestTheHomeRedirectIsEmbedded: the redirect page is tracked, so it is here
// whatever else was built, and it is the whole of a default build's answer to
// the root.
func TestTheHomeRedirectIsEmbedded(t *testing.T) {
	raw, err := fs.ReadFile(site, "home/index.html")
	if err != nil {
		t.Fatalf("home/index.html is not embedded: %v", err)
	}
	page := string(raw)

	if !strings.Contains(page, "url="+sitePrefix) {
		t.Errorf("the home page does not refresh to %s", sitePrefix)
	}
	if !strings.Contains(page, `href="`+sitePrefix+`"`) {
		t.Errorf("the home page has no link to %s for a browser with scripts off", sitePrefix)
	}
	// The mount the router registers is what the page has to name; a rename of
	// one and not the other is a redirect into a 404.
	if sitePrefix != Mount {
		t.Errorf("the home page points at %q, the console is mounted at %q", sitePrefix, Mount)
	}
	// A meta refresh and a link, nothing more: the page's CSP allows no script
	// at all, and a redirect that needs one would silently do nothing.
	if strings.Contains(page, "<script") {
		t.Error("the home page needs JavaScript to redirect")
	}
	if !strings.Contains(page, "noindex") {
		t.Error("the home page invites a search engine to index a redirect")
	}
}

// TestTheHomeSiteAnswersEveryPath: in a build with no docs there is nothing
// else to serve, so every path is the same page - a person following an old
// link lands on the console rather than on a 404.
func TestTheHomeSiteAnswersEveryPath(t *testing.T) {
	home := fstest.MapFS{
		"index.html": {Data: []byte("<html>to the console</html>")},
	}
	handler := homeSite(home)

	for _, path := range []string{"/", "/anything/else", "/docs/intro"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "to the console") {
			t.Errorf("GET %s did not serve the home page", path)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("GET %s Cache-Control = %q, want no-cache", path, got)
		}
		if got := rec.Header().Get("Content-Security-Policy"); !strings.Contains(got, "frame-ancestors 'none'") {
			t.Errorf("GET %s CSP = %q, want it to refuse being framed", path, got)
		}
	}
}

// TestTheDocsSiteServesFilesAndItsOwn404 is the official flavour's behaviour,
// driven from a fake tree so it runs in a default build too: what it checks is
// the handler, and the real tree is checked for presence by
// TestTheOfficialSiteIsEmbedded below.
func TestTheDocsSiteServesFilesAndItsOwn404(t *testing.T) {
	docs := fstest.MapFS{
		"index.html":            {Data: []byte("<html>docs home</html>")},
		"docs/intro/index.html": {Data: []byte("<html>the manual</html>")},
		"404.html":              {Data: []byte("<html>lost in the docs</html>")},
		"assets/app-a1b2c3.js":  {Data: []byte("console.log(1)")},
		"img/logo.png":          {Data: []byte("png")},
	}
	handler := docsSite(docs)

	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	if rec := get("/"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "docs home") {
		t.Errorf("GET / = %d %q, want the docs home", rec.Code, rec.Body.String())
	}
	// Directory style is what Docusaurus emits; the file server redirects to
	// the slash and then serves the index.
	if rec := get("/docs/intro/"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "the manual") {
		t.Errorf("GET /docs/intro/ = %d %q, want the page", rec.Code, rec.Body.String())
	}

	// A hashed asset may be cached forever; a page may not.
	if got := get("/assets/app-a1b2c3.js").Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("asset Cache-Control = %q, want immutable", got)
	}
	if got := get("/img/logo.png").Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("an unhashed image Cache-Control = %q, want no-cache", got)
	}

	// The site's own 404, with a 404 status: a soft 404 tells a monitoring
	// check nothing, and a plain Go 404 would not look like the site.
	rec := get("/no/such/page")
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET a missing page = %d, want 404", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "lost in the docs") {
		t.Errorf("GET a missing page = %q, want the site's own 404", rec.Body.String())
	}

	// A directory with no index is a 404, never a listing of the files that
	// are inside the binary.
	listing := get("/assets/")
	if listing.Code != http.StatusNotFound {
		t.Errorf("GET a directory with no index = %d, want 404", listing.Code)
	}
	if strings.Contains(listing.Body.String(), "app-a1b2c3.js") {
		t.Error("a directory without an index listed the binary's files")
	}
}

// TestTheOfficialSiteIsEmbedded runs only when the documentation is in this
// binary - an official build, which builds it first (tools/embedsite.sh). In a
// default build it says so and moves on, so `go test ./...` needs no flag.
func TestTheOfficialSiteIsEmbedded(t *testing.T) {
	if _, err := fs.Stat(site, "docs/index.html"); err != nil {
		t.Skip("the documentation is not embedded; this is a default build " +
			"(`officialserver=1 pnpm run site:prepare` builds it)")
	}

	handler := SiteHandler()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d, want 200", rec.Code)
	}
	body := rec.Body.String()
	// The one thing the docs must carry in this flavour: a way in to the
	// console that is also served from this server.
	if !strings.Contains(body, Mount) {
		t.Errorf("the docs home does not link to %s", Mount)
	}
	if strings.Contains(body, `"/tabverse/assets/`) || strings.Contains(body, `href="/tabverse/`) {
		t.Error("the embedded docs were built for GitHub Pages: their base URL is /tabverse/")
	}
}
