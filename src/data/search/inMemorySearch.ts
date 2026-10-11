/**
 * In-memory search for the lists a panel already holds.
 *
 * `localSearch.ts` is the offline search the popup uses: a table scan over
 * IndexedDB, returning tabverse ids. This is the cheaper thing a filter box
 * inside a list wants - filter the rows already in the effector store, in
 * memory, with no query at all. The matching rule is deliberately the same
 * substring test `valueMatchesTerms` uses, so a box here and the popup's search
 * agree about what "matches".
 *
 * An empty query is "no filter", not "no results": it returns the list
 * unchanged, which is what a box you have just cleared should do.
 */
import { valueMatchesTerms } from './searchable';

/** "Foo  bar " -> ["foo", "bar"]. */
export function tokenizeFilterText(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
}

/** Every term appears in `text` (case insensitive substring). */
export function textMatchesTerms(text: string, terms: string[]): boolean {
  return valueMatchesTerms(text, terms);
}

/**
 * The items whose text holds every term. `getText` is how a caller says what
 * one row is searchable by - a todo by its content, a note by its name and
 * body, a bookmark by its name and url.
 */
export function filterByText<T>(
  items: readonly T[],
  getText: (item: T) => string,
  text: string,
): T[] {
  const terms = tokenizeFilterText(text);
  if (terms.length <= 0) {
    return items.slice();
  }
  return items.filter((item) => textMatchesTerms(getText(item), terms));
}

/**
 * A note body is TipTap HTML; searching the raw string would let "strong" match
 * a `<strong>` tag. Tags become spaces (so two words either side of one do not
 * run together) and the common entities are decoded; runs of whitespace
 * collapse.
 */
export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
