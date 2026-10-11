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
