/**
 * The console's routing: the query string.
 *
 * `?user=…&tab=…&tabspace=…&view=…&q=…` is a workflow that exists in the field -
 * operators bookmark an account and paste a link from a terminal - so the
 * rewrite keeps it (adr/0018, decision 6). What adr/0023 changed is *where* it
 * lives: the query rather than the fragment, so the console's whole URL is an
 * ordinary HTTP URL - one the server serves under /console, and one that reads
 * the same in a log, a bookmark and a pasted line.
 *
 * The session is a cookie and never travels in a URL; the token-era `#token=`
 * is gone with ADR 0013.
 *
 * `readQuery` / `writeQuery` take the `Location` and `History` they act on
 * rather than reaching for the globals, which is what lets the tests drive a
 * fake one.
 */

export interface RouteState {
  user?: string;
  tab?: string;
  tabspace?: string;
  view?: string;
  q?: string;
}

export interface LocationLike {
  pathname: string;
  search: string;
}

export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

/** Reads the query string, with or without its leading `?`. */
export function readQuery(location: LocationLike): URLSearchParams {
  return new URLSearchParams(location.search.replace(/^\?/, ''));
}

/**
 * Rewrites the query string, leaving keys whose value is empty out of the URL.
 *
 * Every key already there is carried over, which is the point: the routing keys
 * share the query with the pairing request the extension opened this window
 * with (`?pair=…`), and dropping those mid-flow would lose a pairing the person
 * is in the middle of approving.
 */
export function writeQuery(
  location: LocationLike,
  history: HistoryLike,
  patch: RouteState,
): void {
  const params = readQuery(location);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
}
