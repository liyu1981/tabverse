/** A slice of text, flagged when it is a query match to be highlighted. */
export interface TextPart {
  text: string;
  match: boolean;
}

/** Splits `text` on the query terms (case-insensitive) for `<mark>`ing. */
export function highlightTerms(text: string, terms: string[]): TextPart[] {
  const wanted = terms
    .map((term) => term.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!text || wanted.length === 0) {
    return [{ text, match: false }];
  }
  const escaped = wanted.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts: TextPart[] = [];
  let last = 0;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(text)) !== null) {
    if (found.index > last) {
      parts.push({ text: text.slice(last, found.index), match: false });
    }
    parts.push({ text: found[0], match: true });
    last = found.index + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

/** The FTS snippet marks matches with `[ ]`; turn those into `<mark>`s. */
export function parseSnippet(snippet: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = /\[([^\]]*)\]/g;
  let last = 0;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(snippet)) !== null) {
    if (found.index > last) {
      parts.push({ text: snippet.slice(last, found.index), match: false });
    }
    parts.push({ text: found[1], match: true });
    last = found.index + found[0].length;
  }
  if (last < snippet.length) {
    parts.push({ text: snippet.slice(last), match: false });
  }
  return parts;
}
