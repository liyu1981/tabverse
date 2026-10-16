/**
 * A fully rendered page as Markdown: Readability isolates the article, Turndown
 * writes it out.
 *
 * This is the pure half of the "save an opened tab as Markdown" feature - no
 * `chrome`, no `Worker`, no DOM global - so it runs unchanged in a Web Worker
 * (its only real caller) and in a node test. The browser specifics live in
 * `tabText.ts` (read the DOM) and `pageMarkdown.ts` (run this in a worker).
 *
 * `linkedom` is the DOM because a worker has none and Turndown's browser build
 * reaches for a global `document` whenever it is handed an HTML *string*.
 * Passing Turndown an already-parsed node skips that path entirely. Two of
 * linkedom's gaps are worked around here: it has no `HTMLTableElement.rows` /
 * `HTMLTableRowElement.cells` (the GFM table rule needs them), and a document
 * parsed from a string has no base url until one is put in.
 *
 * Readability is the reason the output is worth keeping: handed the whole page
 * it would convert the header, the cookie banner and the footer. When it finds
 * no article at all - a login page, a web app - the whole body is converted
 * instead, so the action still returns something.
 */
import { gfm } from '@joplin/turndown-plugin-gfm';
import { Readability } from '@mozilla/readability';
import { DOMParser, HTMLElement as LinkedomHTMLElement } from 'linkedom/worker';
import TurndownService from 'turndown';

export interface MarkdownArticle {
  /** Readability's title, '' when it did not report one. */
  title: string;
  byline: string;
  siteName: string;
  excerpt: string;
  /** The article, as GitHub-flavored Markdown. Never empty. */
  markdown: string;
}

/** Collapse whitespace, so a title or byline is one clean line. */
function oneLine(text: unknown): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Give linkedom the two table APIs the GFM rule reads. Idempotent, and on the
 * shared `HTMLElement` prototype so the nodes Turndown clones inherit it.
 *
 * The getters are query-backed rather than cached: a row of a nested table is
 * also returned, which a real `rows` would not do - the honest cost of not
 * having `HTMLTableSectionElement`, and the fallback for a table the rule
 * cannot read is its raw HTML.
 */
let tableShimsInstalled = false;

export function installGfmTableShims(): void {
  if (tableShimsInstalled) {
    return;
  }
  tableShimsInstalled = true;
  const proto = LinkedomHTMLElement.prototype as unknown as Record<
    string,
    unknown
  >;
  const describe = (name: string, tag: string, selector: string) => {
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: {
        nodeName: string;
        querySelectorAll(s: string): ArrayLike<unknown>;
      }) {
        return this.nodeName === tag
          ? Array.from(this.querySelectorAll(selector))
          : undefined;
      },
    });
  };
  describe('rows', 'TABLE', 'tr');
  describe('cells', 'TR', 'th,td');
}

/**
 * Resolve relative links and images against the page's own base url. Only a
 * page with no `<base>` of its own gets one, so a page that already declares
 * one keeps it - that declaration is the truth, not the tab url.
 */
function ensureBase(document: Document, url: string): void {
  if (!url || document.querySelector('base[href]')) {
    return;
  }
  const head = document.head;
  if (!head) {
    return;
  }
  const base = document.createElement('base');
  base.setAttribute('href', url);
  head.prepend(base);
}

/** `htmlToMarkdown` for the caller that has the DOM and the libraries. */
export function htmlToMarkdown(
  html: string,
  url: string,
): MarkdownArticle | null {
  const source = String(html ?? '');
  if (source.trim().length === 0) {
    return null;
  }
  installGfmTableShims();

  const document = new DOMParser().parseFromString(source, 'text/html');
  ensureBase(document as unknown as Document, oneLine(url));
  // Captured before Readability runs, because a parse that returns null has
  // still rewritten the document.
  const fallbackBody = document.body?.innerHTML ?? '';

  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(document as unknown as Document).parse();
  } catch {
    article = null;
  }

  const contentHtml =
    article?.content && article.content.trim().length > 0
      ? article.content
      : fallbackBody;
  if (contentHtml.trim().length === 0) {
    return null;
  }

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    // the note editor's own vocabulary (ADR 0030): `*italic*`, `**bold**`
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  turndown.use(gfm);

  const contentDocument = new DOMParser().parseFromString(
    `<!doctype html><html><body>${contentHtml}</body></html>`,
    'text/html',
  );
  const body = contentDocument.body;
  if (!body) {
    return null;
  }
  const markdown = turndown
    .turndown(body as unknown as TurndownService.Node)
    .trim();
  if (markdown.length === 0) {
    return null;
  }

  return {
    title: oneLine(article?.title),
    byline: oneLine(article?.byline),
    siteName: oneLine(article?.siteName),
    excerpt: oneLine(article?.excerpt),
    markdown,
  };
}
