package webui

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// The console is built into dist/ by `pnpm run ui:build` (adr/0018) and is not
// committed. These tests read the bundle that is actually embedded, so what
// they check is what a deployment serves - not what the build should produce.

// TestTheConsoleIsBuilt is the order-enforcing one: everything else here reads
// the shell, and a fresh clone has only the .gitkeep. It is the only test in
// this package that fails for a missing build - the rest skip, so one clear
// message says what to do rather than six that repeat it.
func TestTheConsoleIsBuilt(t *testing.T) {
	if _, err := fs.Stat(dist, "dist/index.html"); err != nil {
		t.Fatalf("the console has not been built: %v\n"+
			"run `pnpm run ui:build` first (`pnpm run server:test` does it for you)",
			err)
	}
}

// requireBundle skips a test that needs the built console. Only useful because
// the test above fails first with the command to run.
func requireBundle(t *testing.T) {
	t.Helper()
	if _, err := fs.Stat(dist, "dist/index.html"); err != nil {
		t.Skip("the console has not been built; TestTheConsoleIsBuilt says so")
	}
}

// TestTheShellReferencesOnlyEmbeddedFiles is the check the bundler cannot make:
// the shell is generated, and it names its own assets. A name that is not in the
// binary is a page that loads into nothing.
func TestTheShellReferencesOnlyEmbeddedFiles(t *testing.T) {
	requireBundle(t)
	shell, err := fs.ReadFile(dist, "dist/index.html")
	if err != nil {
		t.Fatalf("read index.html: %v", err)
	}
	refs := regexp.MustCompile(`(?:src|href)="([^"]+)"`).FindAllStringSubmatch(string(shell), -1)
	if len(refs) == 0 {
		t.Fatal("index.html references no assets at all: the console would be a blank page")
	}
	// A data: URL is the inline favicon, not a file.
	script, style := 0, 0
	for _, ref := range refs {
		url := ref[1]
		if strings.HasPrefix(url, "data:") || strings.HasPrefix(url, "#") {
			continue
		}
		if !strings.HasPrefix(url, "/assets/") {
			t.Errorf("index.html references %q, which is outside the /assets/ space the handler serves", url)
			continue
		}
		// /assets/<name> is the URL space; the bundle's root holds the files.
		name := strings.TrimPrefix(url, "/assets/")
		if _, err := fs.Stat(dist, "dist/"+name); err != nil {
			t.Errorf("index.html references %q, which is not in the embedded bundle: %v", url, err)
			continue
		}
		if strings.HasSuffix(url, ".js") {
			script++
		}
		if strings.HasSuffix(url, ".css") {
			style++
		}
	}
	if script == 0 {
		t.Error("index.html references no script: the console would not boot")
	}
	if style == 0 {
		t.Error("index.html references no stylesheet: the console would be unstyled")
	}
}

// TestAssetNamesAreHashed: the shell must not be cached, its assets must be, and
// the only way to tell them apart is the name.
func TestAssetNamesAreHashed(t *testing.T) {
	requireBundle(t)
	entries, err := fs.ReadDir(dist, "dist")
	if err != nil {
		t.Fatalf("read dist: %v", err)
	}
	hashed := regexp.MustCompile(`^.+-[A-Za-z0-9_-]{6,}\.(js|css)$`)
	assets := 0
	for _, entry := range entries {
		if hashed.MatchString(entry.Name()) {
			assets++
		}
	}
	if assets == 0 {
		t.Error("no hashed assets in the bundle: nothing can be cached immutably")
	}
}

func get(t *testing.T, url string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	return rec
}

func TestTheRootServesTheShell(t *testing.T) {
	requireBundle(t)
	rec := get(t, "/")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET / = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "<div id=\"root\">") {
		t.Errorf("GET / did not serve the console shell: %q", rec.Body.String()[:min(200, rec.Body.Len())])
	}
	if got := rec.Header().Get("Content-Security-Policy"); !strings.Contains(got, "default-src 'none'") {
		t.Errorf("CSP = %q, want the tight policy", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("shell Cache-Control = %q, want no-cache", got)
	}
}

// TestAnUnknownPathIsAClientSideRoute: the console is one page, so anything the
// server does not recognise is the shell again rather than a 404.
func TestAnUnknownPathIsAClientSideRoute(t *testing.T) {
	requireBundle(t)
	rec := get(t, "/accounts/usr_1")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /accounts/usr_1 = %d, want the shell", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "<div id=\"root\">") {
		t.Error("a client side route did not get the shell")
	}
}

// TestABrokenAssetIsA404: the fallback above is for routes, not for files. A
// missing file that quietly became the shell would fail as a page that never
// boots, with nothing in the network tab to explain it.
func TestABrokenAssetIsA404(t *testing.T) {
	rec := get(t, "/assets/index-notthere.js")
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET a missing asset = %d, want 404", rec.Code)
	}
}

func TestAssetsAreServedImmutable(t *testing.T) {
	requireBundle(t)
	shell, err := fs.ReadFile(dist, "dist/index.html")
	if err != nil {
		t.Fatalf("read index.html: %v", err)
	}
	match := regexp.MustCompile(`src="(/assets/[^"]+\.js)"`).FindStringSubmatch(string(shell))
	if match == nil {
		t.Skip("the shell references no script to check")
	}
	rec := get(t, match[1])
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d", match[1], rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("asset Cache-Control = %q, want immutable", got)
	}
	if rec.Body.Len() == 0 {
		t.Error("the asset served empty")
	}
}

// TestTheStylesheetCarriesTheProductLayer: the console's own look is a plain
// stylesheet over Blueprint's, so its tokens have to survive the build. This is
// the cheapest way to catch a build that quietly stopped emitting our CSS.
func TestTheStylesheetCarriesTheProductLayer(t *testing.T) {
	requireBundle(t)
	css := bundleText(t, ".css")

	// `--brand` is the console's own token layer and `bp6-card` is the Blueprint
	// base it is drawn over. Both have to survive the build or the console is
	// the extension's components with nothing of its own around them.
	for _, want := range []string{"--brand", "bp6-card"} {
		if !strings.Contains(css, want) {
			t.Errorf("the stylesheet has no %q: the console's own layer did not survive the build", want)
		}
	}

	// The drawer draws tab groups with the extension's own component, which
	// carries Chrome's nine group colours (adr/0019). They are set inline from
	// TAB_GROUP_COLORS_JS rather than in CSS, so they are looked for in the
	// script: if it stops being there, the console has quietly lost the tabverse
	// view it went there for.
	js := bundleText(t, ".js")
	if !strings.Contains(js, "3b6fd4") {
		t.Error("the bundle has no tab group colours: the extension's tabverse view is not in it")
	}
}

// TestTheBundleCarriesNoUnknownSelectors: a stylesheet that names a
// pseudo-element no browser has is a warning, not a failure - and a warning that
// scrolls past is how dead CSS survives for years. The console compiles the
// extension's own stylesheets (adr/0019), so its TodoMVC rules are in here, and
// the one that used to be in them (`input::input-placeholder`) matched nothing in
// any browser. lightningcss names the offender; this fails on it instead.
func TestTheBundleCarriesNoUnknownSelectors(t *testing.T) {
	requireBundle(t)
	css := bundleText(t, ".css")

	if strings.Contains(css, "::input-placeholder") {
		t.Error("the bundle has an `::input-placeholder` rule: that pseudo-element does not exist, so the rule matches nothing")
	}
	if !strings.Contains(css, "::placeholder") {
		t.Error("the bundle has no `::placeholder` rule at all: a placeholder selector was lost somewhere")
	}
}

// bundleText concatenates every built file with the given extension, which is
// how the bundle is read here: the names are content hashed, so a test cannot
// name a file.
func bundleText(t *testing.T, ext string) string {
	t.Helper()
	entries, err := fs.ReadDir(dist, "dist")
	if err != nil {
		t.Fatalf("read dist: %v", err)
	}
	out := ""
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ext) {
			continue
		}
		body, err := fs.ReadFile(dist, "dist/"+entry.Name())
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		out += string(body)
	}
	if out == "" {
		t.Fatalf("the bundle has no %s files", ext)
	}
	return out
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
