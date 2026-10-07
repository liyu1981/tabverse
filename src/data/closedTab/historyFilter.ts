/**
 * Searching and grouping the closed tabs of one tabverse.
 *
 * Two questions the History card asks about the rows it is already holding, and
 * both are answered here, without the database, the server or an index:
 * "which of these was the page I was after" and "which pages did I close on
 * this site".
 *
 * This is the third filter in the extension and, like the other two, it is not
 * the search in `data/search` (ADR 0008). That one answers "which tabverse
 * holds this", across every tabverse on the account, and goes to the server when
 * one is paired. This one answers about the rows on screen, so it is a
 * substring test over a list the user is already reading - the same deliberate
 * trade the live tab filter makes (`data/tabSpace/activeTabFilter`).
 *
 * The rules it does borrow from that search are borrowed on purpose:
 *
 * - A term matches *inside* a word (`valueMatchesTerms`), because a filter box
 *   that only matched whole words is not a filter box.
 * - The terms may come from either field of a row, and a term may come from the
 *   title while another comes from the url: "github issues" is one closed tab,
 *   and the words are split across its two fields. The global search is weaker
 *   here - `localSearch` needs every term inside one field - because a scope
 *   there means "this row's title *or* its url", and the looser rule is not
 *   worth being loose about when the answer is a whole tabverse.
 * - Case is ignored, because nobody remembers which case a title was in.
 *
 * Nothing here ranks. The history is a timeline, and a page closed an hour ago
 * stays above one closed last Tuesday no matter how well its title matches - and
 * a site's rows are drawn newest first for the same reason.
 */

/** The two fields of a closed tab a person looks at. */
export interface HistorySearchable {
  title?: string;
  url?: string;
}

/**
 * Where an entry with no site to name goes: a blank url, or text that is not a
 * url at all. A row is never dropped for want of a group, so this bucket is
 * where those land.
 */
export const NO_HISTORY_SITE = '(no site)';

/** Entries that can be told apart by site, which is what a group is. */
export interface HistorySiteGroup<T> {
  /**
   * The lower cased host - `github.com`, without a leading `www.` - or the
   * scheme for a page that has no host (`chrome:`, `file:`, `about:`), or
   * `NO_HISTORY_SITE`. It is also the header a person reads, so there is no
   * second label to keep in step with it.
   */
  site: string;
  /** That site's entries, newest first - the order they came in. */
  entries: T[];
}

/** What the box is asking for: its text split into terms, lowercased. */
export function historySearchTerms(text: string): string[] {
  return text
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}

/** Whether the box holds anything worth filtering by. */
export function isHistorySearchActive(text: string): boolean {
  return historySearchTerms(text).length > 0;
}

/**
 * The entries the box matches, in the order they came in.
 *
 * An entry matches when *every* term is somewhere in it, and each term may be
 * in the title or in the url. A blank box is not a filter: it returns the whole
 * list, so a caller can render the result of this unconditionally - the same
 * contract `filterActiveTabs` gives the live tabverse list.
 */
export function matchHistoryEntries<T extends HistorySearchable>(
  entries: readonly T[],
  text: string,
): T[] {
  const terms = historySearchTerms(text);
  if (terms.length <= 0) {
    return entries.slice();
  }
  return entries.filter((entry) =>
    terms.every((term) => matchesTerm(entry, term)),
  );
}

/**
 * One term against one row: a case insensitive substring of the title or of the
 * url. `valueMatchesTerms` is this rule for a whole query against a whole
 * field; applied a term at a time it is what lets "github issues" match a row
 * that only says "github" in the title.
 */
function matchesTerm(entry: HistorySearchable, term: string): boolean {
  const title = entry.title ?? '';
  const url = entry.url ?? '';
  return title.toLowerCase().includes(term) || url.toLowerCase().includes(term);
}

/**
 * The schemes whose host names a site.
 *
 * Everything else (`chrome:`, `chrome-extension:`, `about:`, `blob:`) is a page
 * the browser or the extension serves, and their "hosts" are page names.
 */
const WEB_SCHEMES = ['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:'];

/**
 * The site a closed tab belongs to, as a header a person reads.
 *
 * The host, lower cased, without a leading `www.`: `www.github.com` and
 * `github.com` are the same site to anyone closing tabs, and splitting them
 * would answer "which pages was I reading here" with two half answers. It is
 * the host and not the registrable domain, because a public suffix list is a
 * dependency this does not need - `mail.google.com` is a site of its own here,
 * which is the same thing Chrome's own history does.
 *
 * A page the browser serves itself is named by its scheme, not by its host:
 * `chrome://extensions` has a host of `extensions`, which is a page on the
 * settings screen and not a site anybody was reading, so it groups under
 * `chrome:` - as do `chrome-extension://…` pages, under `chrome-extension`.
 * `file:///tmp` has no host at all and groups under `file:`. Text that is not a
 * url goes to `NO_HISTORY_SITE`: a row is never dropped for want of a group.
 */
export function historySiteOf(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return NO_HISTORY_SITE;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return NO_HISTORY_SITE;
  }
  const scheme = parsed.protocol.replace(/:$/, '');
  const host = parsed.hostname.toLowerCase();
  // only a scheme that names the web has a host that means a site
  if (host && WEB_SCHEMES.includes(parsed.protocol)) {
    return host.startsWith('www.') ? host.slice('www.'.length) : host;
  }
  return scheme || NO_HISTORY_SITE;
}

/**
 * The entries under one header per site, newest first inside each group.
 *
 * Groups appear in the order their first entry appeared, so on the newest-first
 * list the store keeps (`AllClosedTab.sortByClosedAt`) the site whose newest
 * page is the newest of all comes first, and each group's rows are the order
 * they came in - newest first. Nothing is reordered: grouping only decides
 * which rows sit under which header.
 *
 * Sites are compared by their `historySiteOf` name, so the same site reached as
 * `GitHub.com` and `github.com` is one group, and a row is never lost: an entry
 * goes to the site its url names or to `NO_HISTORY_SITE`.
 */
export function groupHistoryBySite<T extends HistorySearchable>(
  entries: readonly T[],
): HistorySiteGroup<T>[] {
  const bySite = new Map<string, T[]>();
  for (const entry of entries) {
    const site = historySiteOf(entry.url ?? '');
    const group = bySite.get(site);
    if (group) {
      group.push(entry);
    } else {
      bySite.set(site, [entry]);
    }
  }
  const groups: HistorySiteGroup<T>[] = [];
  for (const [site, siteEntries] of bySite) {
    groups.push({ site, entries: siteEntries });
  }
  return groups;
}
