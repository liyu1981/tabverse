/**
 * A note's body, as text an operator can read safely.
 *
 * A note's `data` is HTML: TipTap writes it, and the pre-TipTap draft-js format
 * is converted on read (`normalizeNoteHtml`, which the console reuses so an old
 * note reads the same here as it does in the extension). The extension puts
 * that HTML into its own editor, on its own page, for a note its owner wrote.
 *
 * The console is a different trust relationship: the HTML was written on
 * somebody else's machine, and the page rendering it holds that person's whole
 * account - the pairing codes, the tokens, the delete button. Rendering it as
 * markup here would mean either trusting it or writing a sanitizer, and a
 * sanitizer nobody can test (this repository has no DOM in its test environment,
 * and AGENTS.md forbids installing one) is a sanitizer nobody should ship.
 *
 * So the console does not render it: the tags are removed and what is left is
 * text, which React escapes like everything else on the page. An operator
 * reading a note wants to read it; the bold can wait.
 */

/** The blocks that should end a line rather than run into the next. */
const BLOCK_TAGS =
  '</p>|</div>|</li>|</h[1-6]>|</blockquote>|<br\\s*/?>|<hr\\s*/?>';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/**
 * HTML as plain text: no markup, no links, no script, no surprises.
 *
 * `<script>` and `<style>` go with their contents (their text is code, not
 * prose), block boundaries become newlines, and every remaining tag is dropped.
 * Entity references are decoded after the tags are gone, so `&lt;b&gt;` reads as
 * the text `<b>` instead of becoming a tag again.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';

  const withoutCode = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    // An unclosed tag at the end is the browser's problem, not ours; dropping
    // everything from it on keeps its contents from being read as text.
    .replace(/<(script|style)\b[^>]*>[\s\S]*$/i, '');

  const withBreaks = withoutCode.replace(new RegExp(BLOCK_TAGS, 'gi'), '\n');

  const text = withBreaks
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(
      /&[a-z]+;|&#\d+;/gi,
      (entity) => ENTITIES[entity.toLowerCase()] ?? entity,
    );

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
    .trim();
}
