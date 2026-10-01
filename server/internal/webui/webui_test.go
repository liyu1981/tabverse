package webui

import (
	"regexp"
	"strings"
	"testing"
)

// The console is three hand written files with no bundler and no type checker
// between them: console.js reaches the DOM by string id, so a rename in
// index.html is a runtime crash that only a browser would catch. These checks
// are the cheap part of catching it, and they need no browser.
//
// The UI itself is still verified by hand (AGENTS.md): these tests assert the
// contract the script and the page agree on, not how anything looks.

func readAsset(t *testing.T, name string) string {
	t.Helper()
	data, err := assets.ReadFile("assets/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(data)
}

var idPattern = regexp.MustCompile(`id="([^"]+)"`)

func htmlIDs(t *testing.T) map[string]bool {
	t.Helper()
	ids := map[string]bool{}
	for _, m := range idPattern.FindAllStringSubmatch(readAsset(t, "index.html"), -1) {
		id := m[1]
		if ids[id] {
			t.Errorf("duplicate id %q in index.html: the second one is unreachable, "+
				"since querySelector returns the first", id)
		}
		ids[id] = true
	}
	return ids
}

func TestAssetIDsAreUnique(t *testing.T) {
	// htmlIDs fails the test on a duplicate; this is here so the intent is
	// visible as a named test rather than only as a side effect above.
	htmlIDs(t)
}

var selectorPattern = regexp.MustCompile(`\$\('#([A-Za-z0-9_-]+)'\)`)

func TestEverySelectorInTheScriptExistsInThePage(t *testing.T) {
	ids := htmlIDs(t)
	script := readAsset(t, "console.js")
	seen := map[string]bool{}
	for _, m := range selectorPattern.FindAllStringSubmatch(script, -1) {
		seen[m[1]] = true
	}
	if len(seen) < 20 {
		t.Fatalf("only found %d selectors; the pattern probably stopped matching", len(seen))
	}
	for id := range seen {
		if !ids[id] {
			t.Errorf("console.js uses $('#%s') but index.html has no such id", id)
		}
	}
}

var (
	tabPattern    = regexp.MustCompile(`data-tab="([^"]+)"`)
	panelPattern  = regexp.MustCompile(`data-panel="([^"]+)"`)
	viewPattern   = regexp.MustCompile(`data-view="([^"]+)"`)
	panelIDPrefix = "panel-"
)

func TestEveryTabHasAPanel(t *testing.T) {
	// The rail switches panels by matching these two attributes; a tab without
	// a panel opens an empty page, and a panel without a tab is unreachable.
	page := readAsset(t, "index.html")
	tabs := map[string]bool{}
	for _, m := range tabPattern.FindAllStringSubmatch(page, -1) {
		tabs[m[1]] = true
	}
	panels := map[string]bool{}
	for _, m := range panelPattern.FindAllStringSubmatch(page, -1) {
		panels[m[1]] = true
	}
	if len(tabs) == 0 || len(panels) == 0 {
		t.Fatalf("found %d tabs and %d panels; the attributes changed shape", len(tabs), len(panels))
	}
	for tab := range tabs {
		if !panels[tab] {
			t.Errorf(`tab %q has no panel (data-panel="%s")`, tab, tab)
		}
		if !strings.Contains(page, `id="`+panelIDPrefix+tab+`"`) {
			t.Errorf(`tab %q has no panel element with id "%s%s" for its aria-controls`, tab, panelIDPrefix, tab)
		}
	}
	for panel := range panels {
		if !tabs[panel] {
			t.Errorf(`panel %q is unreachable: no tab switches to it`, panel)
		}
	}
}

func TestStoredDataSubViewsAllExist(t *testing.T) {
	// The three views inside the Stored data tab, plus the containers the
	// script shows and hides between them.
	page := readAsset(t, "index.html")
	ids := htmlIDs(t)
	views := map[string]bool{}
	for _, m := range viewPattern.FindAllStringSubmatch(page, -1) {
		views[m[1]] = true
	}
	for _, want := range []string{"tabverses", "search", "records"} {
		if !views[want] {
			t.Errorf("no button for the %q view", want)
		}
		if !ids["data-"+want] {
			t.Errorf("the %q view has no container with id data-%s", want, want)
		}
	}
}

// The whole point of the tabbed layout is that these three are reachable, and
// that the account header and the two empty states are not orphaned by it.
func TestAccountChromeIsStillReachable(t *testing.T) {
	ids := htmlIDs(t)
	// Everything the tabbed layout is made of, still wired to something.
	for _, id := range []string{
		"view-account", // the tab rail and its panels
		"drawer",       // the tabverse detail, which slides over them
		"drawer-body",
		"drawer-delete",
		"view-signin",  // the account login
		"view-login",   // the break-glass token screen
		"assume-bar",   // the read only banner an operator must not miss
		"account-head", // the account title and its owner actions
		"rail-admin",   // the operator's fourth tab
		"panel-admin",  // ...and the directory it shows
		"directory-table",
		"sign-out",
	} {
		if !ids[id] {
			t.Errorf("index.html lost #%s", id)
		}
	}
	// And the things that were in the accounts sidebar, which is gone (adr/0014):
	// a second copy of the directory for an operator, a single useless row for a
	// person, and a create-account form that could only make an account nobody
	// can prove they own.
	for _, id := range []string{
		"sidebar-accounts",
		"create-user-form",
		"new-user-name",
		"impersonate",    // its power is a directory row now
		"set-role",       // ...as is the role switch
		"view-directory", // the directory is a tab panel, not a view
		"account-stats-", // the one stat strip, split between two tabs
		// the tabverse detail is a drawer over the account now, so the view
		// that used to replace the account is gone with it
		"view-tabspace",
		"tabspace-back",
		"tabspace-body",
	} {
		if ids[id] {
			t.Errorf("#%s is still in the page and should not be", id)
		}
	}
}

// The rail and the panels have to agree: a tab with no panel opens an empty
// page, and a panel with no tab is unreachable.
func TestRailAndPanelsMatch(t *testing.T) {
	page := readAsset(t, "index.html")
	tabs := map[string]bool{}
	for _, m := range regexp.MustCompile(`data-tab="([^"]+)"`).FindAllStringSubmatch(page, -1) {
		tabs[m[1]] = true
	}
	panels := map[string]bool{}
	for _, m := range regexp.MustCompile(`data-panel="([^"]+)"`).FindAllStringSubmatch(page, -1) {
		panels[m[1]] = true
	}
	if len(tabs) != 4 || len(panels) != 4 {
		t.Fatalf("expected 4 tabs and 4 panels, got %d and %d: %v %v",
			len(tabs), len(panels), tabs, panels)
	}
	for tab := range tabs {
		if !panels[tab] {
			t.Errorf("tab %q has no panel", tab)
		}
		if !strings.Contains(page, `aria-controls="panel-`+tab+`"`) {
			t.Errorf("tab %q points at no panel for aria-controls", tab)
		}
	}
}

// A favicon is whatever size its file happens to be - a 180px SVG is a perfectly
// normal favicon - so the console pins it, and the row that renders one must
// not grow to fit it. The rule used to be scoped to `.tab-row`, which the
// drawer's tab cards do not use: the icons rendered at their intrinsic size
// there and the rows grew to match, squeezing the title and url into a
// one-character column. Nothing about that was visible without a browser, which
// is exactly what the rest of this file is for.
func TestTheFaviconIsSixteenPixels(t *testing.T) {
	// comments go first: the rule's own comment talks about the selectors, and
	// a regex over the raw file would read that prose as the selector list
	css := strings.ReplaceAll(
		regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(
			readAsset(t, "console.css"), ""),
		"\n\n", "\n",
	)

	// The rule, and the selectors it applies to. `.fav` is the catch-all; the
	// drawer's row is named too, so `li.tab-card > img` is pinned whether or
	// not the script labelled it - which is the selector the drawer really
	// renders.
	rule := regexp.MustCompile(`(?ms)^([^{}]*\.fav[^{}]*)\{(.*?)\n\}`)
	m := rule.FindStringSubmatch(css)
	if m == nil {
		t.Fatal("console.css has no rule that sizes .fav")
	}
	selectors, body := m[1], m[2]
	entries := strings.Split(selectors, ",")
	var hasBareFav, hasTabCard bool
	for _, entry := range entries {
		switch strings.TrimSpace(entry) {
		case ".fav":
			hasBareFav = true
		case ".tab-card > img":
			hasTabCard = true
		case "":
		default:
			t.Errorf("the favicon rule has an unexpected selector %q: a rule "+
				"scoped to one parent is what this test exists to prevent",
				strings.TrimSpace(entry))
		}
	}
	if !hasBareFav {
		t.Error("the favicon rule does not apply to .fav on its own, so a " +
			"favicon rendered outside the drawer's row is sized by nothing")
	}
	if !hasTabCard {
		t.Error("the favicon rule does not cover .tab-card > img, the drawer's " +
			"tab row, so a big icon there grows the row again")
	}

	// 16px is the point: a size, not just any declaration
	for _, want := range []string{"width: 16px;", "height: 16px;", "object-fit:"} {
		if !strings.Contains(body, want) {
			t.Errorf("the favicon rule has no %q:\n%s", want, body)
		}
	}

	script := readAsset(t, "console.js")
	if !strings.Contains(script, "class: 'fav'") {
		t.Error("console.js renders no .fav element, so the rule is dead code")
	}
	// and the drawer's favicon really is a direct child of the card, or the
	// `.tab-card > img` half of the selector would match nothing
	direct := regexp.MustCompile(`(?s)'li',\s*\{\s*class:\s*'tab-card'\s*\},\s*fav,`)
	if !direct.MatchString(script) {
		t.Error("console.js does not put the favicon directly inside the " +
			"tab card, so `.tab-card > img` matches nothing")
	}
}
