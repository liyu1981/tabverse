import { Tab } from './Tab';

/**
 * The filter box over the tabs of the tabverse on screen.
 *
 * This is deliberately not the search in `data/search`: that one answers
 * "which tabverse holds this", across every tabverse the account has, and goes
 * to the server when one is paired. This one answers "which of the tabs I am
 * looking at right now is this", so it is a substring test over the list the
 * user is already reading - no index, no scopes, no network, and no ranking
 * that pretends to be an FTS score. The same substring semantics as
 * `valueMatchesTerms` (a filter box is expected to match inside a word), one
 * scoring rule on top so the best match comes first.
 */

/** Which of a tab's two searchable fields the whole query was found in. */
export type ActiveTabMatchField = 'title' | 'url';

export interface ActiveTabMatch {
  tab: Tab;
  /**
   * 'title' when every term was in the title, 'url' when at least one was only
   * in the url. A tabverse list is read by title, so a title hit is the answer
   * and a url hit is the consolation prize.
   */
  field: ActiveTabMatchField;
  /** Higher is better; only ever compared with another tab's score. */
  score: number;
}

/** A hit in the title is worth more than the same hit in the url. */
const TITLE_WEIGHT = 2;
const URL_WEIGHT = 1;
/** The terms next to each other, in that order, in one title. */
const PHRASE_BONUS = 2;

/** What the box is asking for: its text split into terms, lowercased. */
export function activeTabFilterTerms(text: string): string[] {
  return text
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
}

/** Whether the box holds anything worth filtering by. */
export function isActiveTabFilterActive(text: string): boolean {
  return activeTabFilterTerms(text).length > 0;
}

/**
 * The tabs of a list that match the box, best first.
 *
 * A tab matches when *every* term is somewhere in it - a term may come from
 * the title and another from the url, because "github issues" is one tab and
 * the words are split across its two fields. A blank box is not a filter: it
 * returns the whole list, in the order it came in, so a caller can render the
 * result of this unconditionally.
 */
export function matchActiveTabs(
  tabs: readonly Tab[],
  text: string,
): ActiveTabMatch[] {
  const terms = activeTabFilterTerms(text);
  if (terms.length <= 0) {
    return tabs.map((tab) => ({ tab, field: 'title' as const, score: 0 }));
  }
  const phrase = terms.join(' ');

  const found: { match: ActiveTabMatch; firstAt: number; order: number }[] = [];
  for (let order = 0; order < tabs.length; order++) {
    const tab = tabs[order];
    if (!tab) {
      continue;
    }
    const title = (tab.title ?? '').toLowerCase();
    const url = (tab.url ?? '').toLowerCase();
    let score = 0;
    let titleHits = 0;
    let firstAt = Number.MAX_SAFE_INTEGER;
    for (const term of terms) {
      const inTitle = title.indexOf(term);
      const inUrl = url.indexOf(term);
      if (inTitle < 0 && inUrl < 0) {
        // one term is nowhere to be found: this tab is out
        score = -1;
        break;
      }
      if (inTitle >= 0) {
        score += TITLE_WEIGHT;
        titleHits += 1;
        firstAt = Math.min(firstAt, inTitle);
      }
      if (inUrl >= 0) {
        score += URL_WEIGHT;
        firstAt = Math.min(firstAt, inUrl);
      }
    }
    if (score < 0) {
      continue;
    }
    if (title.includes(phrase)) {
      score += PHRASE_BONUS;
    }
    found.push({
      match: {
        tab,
        field: titleHits === terms.length ? 'title' : 'url',
        score,
      },
      firstAt,
      order,
    });
  }

  found.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      a.firstAt - b.firstAt ||
      a.order - b.order,
  );
  return found.map((candidate) => candidate.match);
}

/** Just the tabs, for a caller that has no use for the score. */
export function filterActiveTabs(tabs: readonly Tab[], text: string): Tab[] {
  return matchActiveTabs(tabs, text).map((match) => match.tab);
}
