/**
 * A note's Markdown body as plain text.
 *
 * Two readers want this: the extension's in-list filter (a note is searchable
 * by its name and body), and the console's read-only note card. Both want the
 * words, not the markup.
 *
 * The console is the reason the HTML handling is here, not just the markdown
 * one. A note is written on somebody else's machine, and the page showing it
 * holds that person's whole account - pairing codes, tokens, the delete button.
 * Markdown allows raw HTML, so the body is still untrusted markup: `<script>`
 * and `<style>` go with their contents (that text is code, not prose), an
 * unclosed one takes the rest of the line, and every remaining tag is dropped.
 * Nothing here builds a DOM, which is the point - the tests have none, and a
 * sanitizer nobody can test is one nobody should ship.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return '';

  let text = String(markdown).replace(/\r\n?/g, '\n');

  // Raw HTML first, so its tags cannot be read as markdown or as text.
  text = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*$/i, '')
    .replace(/<[^>]*>/g, ' ');

  // Links and images keep their words, not their targets.
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Code keeps its text and loses its markers: inline backticks and the fence
  // line of a fenced block.
  text = text.replace(/`([^`]*)`/g, '$1').replace(/^\s{0,3}```[^\n]*$/gm, '');

  // Line-leading syntax: headings, blockquotes, list markers, task boxes, rules.
  text = text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s{0,3}>\s?/, '')
        .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\[[ xX]\]\s?/, '')
        .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/, ''),
    )
    .join('\n');

  // Inline emphasis markers: underline (Tiptap's `++`), strike, bold, italic.
  text = text
    .replace(/\+\+/g, '')
    .replace(/~~/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1$2');

  // Entities come last, so `&lt;b&gt;` reads as the text `<b>` rather than
  // becoming a tag the line above would then strip.
  text = text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
    .trim();
}
