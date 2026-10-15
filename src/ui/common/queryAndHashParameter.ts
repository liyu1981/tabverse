/**
 * The query parameters of the page, values decoded.
 *
 * `tabverseUrl` url-encodes what it puts in the url - a tabverse id, and a new
 * tabverse's rail colour, whose `#` would otherwise start the fragment - so the
 * reader has to decode to hand back what the opener meant. A malformed escape
 * is left as written rather than thrown: a hand-edited url should still open a
 * page.
 */
export function getQueryParameters(): { [k: string]: string } {
  const result: { [k: string]: string } = {};
  const locationSearch: string = window.location.search;
  locationSearch
    .substr(1)
    .split('&')
    .forEach((item: string) => {
      const tmp = item.split('=');
      if (tmp[0]) {
        result[tmp[0]] = decodeQueryValue(tmp.slice(1).join('='));
      }
    });
  return result;
}

function decodeQueryValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
