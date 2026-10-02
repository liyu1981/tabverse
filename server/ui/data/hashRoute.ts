/**
 * The console's routing: the URL fragment.
 *
 * `#user=…&tab=…&tabspace=…&view=…&q=…` is a workflow that exists in the field -
 * operators bookmark an account and paste a link from a terminal - so the
 * rewrite keeps it (adr/0018, decision 6). The session is a cookie and never
 * travels in a URL; the token-era `#token=` is gone with ADR 0013.
 *
 * `readHash` / `writeHash` take the `Location` and `History` they act on rather
 * than reaching for the globals, which is what lets the tests drive a fake one.
 */

export interface RouteState {
  user?: string;
  tab?: string;
  tabspace?: string;
  view?: string;
  q?: string;
}

export interface LocationLike {
  hash: string;
  pathname: string;
  search: string;
}

export interface HistoryLike {
  replaceState(data: unknown, unused: string, url?: string | null): void;
}

export function readHash(location: LocationLike): URLSearchParams {
  return new URLSearchParams(location.hash.replace(/^#/, ''));
}

/** Rewrites the fragment, leaving keys whose value is empty out of the URL. */
export function writeHash(
  location: LocationLike,
  history: HistoryLike,
  patch: RouteState,
): void {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const rest = params.toString();
  history.replaceState(
    null,
    '',
    location.pathname + location.search + (rest ? '#' + rest : ''),
  );
}
