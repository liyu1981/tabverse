/**
 * Reading the visible text of a live Chrome tab.
 *
 * This is the one part of the summarize-a-tab feature that has to touch the
 * page itself, and it does so on demand: `chrome.scripting.executeScript` runs
 * a small function in the tab only when the person asks for a summary, not on
 * every page load. That needs the `scripting` permission (and the `<all_urls>`
 * host permission the extension already holds), which is the one manifest
 * change the feature costs - see doc/tabverse-summarize-tab-plan.md.
 *
 * The extractor is injectable so the rest of the flow - the prompt, the
 * summary, the note - is testable with no browser. The default is the only
 * function that touches `chrome.scripting`, and it fails soft: a `chrome://`
 * page, a PDF viewer, or a tab that navigated away returns null, and the caller
 * says "could not read this tab" rather than throwing.
 */
import { logger } from '../../global';

/**
 * How much page text is handed to the model, in characters. A long article is
 * well under this; a page that is one giant feed is cut here, before the prompt
 * budget is applied again in `ai/summarize.ts`.
 */
export const MAX_TAB_TEXT_CHARS = 12000;

export function capTabText(
  text: string,
  max: number = MAX_TAB_TEXT_CHARS,
): string {
  const clean = String(text ?? '');
  if (clean.length <= max) {
    return clean;
  }
  return clean.slice(0, max);
}

/** Reads one tab's text, or null when it cannot be read. */
export type TabTextExtractor = (chromeTabId: number) => Promise<string | null>;

let injectedExtractor: TabTextExtractor | null = null;

/**
 * The function that runs inside the page. It must be self-contained - Chrome
 * serializes it and runs it in another context, so it cannot close over
 * anything from this module.
 */
function readPageText(): string {
  const body = document.body;
  if (!body) {
    return '';
  }
  return body.innerText || body.textContent || '';
}

async function defaultExtractor(chromeTabId: number): Promise<string | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: chromeTabId },
    func: readPageText,
  });
  const first = results?.[0]?.result;
  return typeof first === 'string' ? first : null;
}

/**
 * The visible text of the tab, or null when Chrome will not let us read it
 * (a `chrome://` page, the Web Store, a page that went away). Never throws.
 */
export async function extractTabText(
  chromeTabId: number,
): Promise<string | null> {
  if (chromeTabId <= 0) {
    return null;
  }
  const extractor = injectedExtractor ?? defaultExtractor;
  try {
    const text = await extractor(chromeTabId);
    return text === null ? null : capTabText(text);
  } catch (err) {
    logger.log('could not read the tab text', chromeTabId, err);
    return null;
  }
}

/** Test hook: replace the browser with a fixed extractor. */
export function setTabTextExtractorForTest(
  extractor: TabTextExtractor | null,
): void {
  injectedExtractor = extractor;
}

/** A live tab's rendered markup, plus the base url its links resolve against. */
export interface TabHtmlContent {
  html: string;
  url: string;
}

/** Reads one tab's markup, or null when it cannot be read. */
export type TabHtmlExtractor = (
  chromeTabId: number,
) => Promise<TabHtmlContent | null>;

let injectedHtmlExtractor: TabHtmlExtractor | null = null;

/**
 * The function that runs inside the page. Self-contained, like `readPageText`.
 *
 * The clone is what keeps this a read: stripping the script/style/template
 * nodes off the page itself would change the page the person is looking at.
 * They are dropped because an inline hydration blob (`__NEXT_DATA__`) can dwarf
 * the prose, and neither Readability nor Turndown has any use for them.
 */
function readPageHtml(): TabHtmlContent | null {
  const root = document.documentElement;
  if (!root) {
    return null;
  }
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('script,style,noscript,template,link')
    .forEach((node) => {
      node.remove();
    });
  return {
    html: clone.outerHTML,
    url: document.baseURI || document.location?.href || '',
  };
}

async function defaultHtmlExtractor(
  chromeTabId: number,
): Promise<TabHtmlContent | null> {
  const results = await chrome.scripting.executeScript({
    target: { tabId: chromeTabId },
    func: readPageHtml,
  });
  const first = results?.[0]?.result as TabHtmlContent | null | undefined;
  if (!first || typeof first.html !== 'string') {
    return null;
  }
  return {
    html: first.html,
    url: typeof first.url === 'string' ? first.url : '',
  };
}

/**
 * The rendered markup of the tab, or null when Chrome will not let us read it
 * (a `chrome://` page, the Web Store, a page that went away). Never throws.
 */
export async function extractTabHtml(
  chromeTabId: number,
): Promise<TabHtmlContent | null> {
  if (chromeTabId <= 0) {
    return null;
  }
  const extractor = injectedHtmlExtractor ?? defaultHtmlExtractor;
  try {
    return await extractor(chromeTabId);
  } catch (err) {
    logger.log('could not read the tab html', chromeTabId, err);
    return null;
  }
}

/** Test hook: replace the browser with a fixed html extractor. */
export function setTabHtmlExtractorForTest(
  extractor: TabHtmlExtractor | null,
): void {
  injectedHtmlExtractor = extractor;
}
