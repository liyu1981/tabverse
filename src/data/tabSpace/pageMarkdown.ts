/**
 * Converting one opened tab to Markdown, in a worker.
 *
 * The step is one user action, so it gets one worker: created for the run,
 * handed the page markup and the base url, and terminated the moment the answer
 * (or the timeout) lands. Nothing is pooled and nothing is kept, so a second
 * conversion can never be answered from the first page.
 *
 * The extraction is `tabText.ts` (the only part that touches `chrome.scripting`)
 * and the conversion is `articleMarkdown.ts` (pure, `chrome`-free) - which is
 * also what makes this testable: a test replaces the extractor and the runner,
 * and neither a browser nor a worker is involved. A failure is `null` and never
 * a throw: the caller shows one honest line.
 */
import { logger } from '../../global';
import type { MarkdownArticle } from './articleMarkdown';
import { extractTabHtml } from './tabText';

export type { MarkdownArticle };

/** Runs the pure conversion somewhere other than this thread. */
export type MarkdownRunner = (
  html: string,
  url: string,
) => Promise<MarkdownArticle | null>;

/** A page that has not converted in this long is not going to. */
export const MARKDOWN_WORKER_TIMEOUT_MS = 20000;

let injectedRunner: MarkdownRunner | null = null;

interface MarkdownWorkerResponse {
  ok: boolean;
  article?: MarkdownArticle | null;
  error?: string;
}

function defaultRunner(
  html: string,
  url: string,
): Promise<MarkdownArticle | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./pageMarkdown.worker.ts', import.meta.url),
      { type: 'module' },
    );
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error('the conversion timed out')));
    }, MARKDOWN_WORKER_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
      finish(() => {
        if (event.data?.ok) {
          resolve(event.data.article ?? null);
          return;
        }
        reject(new Error(event.data?.error ?? 'the conversion failed'));
      });
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'the conversion failed')));
    };
    worker.postMessage({ html, url });
  });
}

/**
 * A live tab's article as Markdown, or null when the page cannot be read or
 * the conversion fails. Never throws.
 */
export async function convertTabToMarkdown(
  chromeTabId: number,
): Promise<MarkdownArticle | null> {
  if (chromeTabId <= 0) {
    return null;
  }
  const content = await extractTabHtml(chromeTabId);
  if (!content) {
    return null;
  }
  const runner = injectedRunner ?? defaultRunner;
  try {
    return await runner(content.html, content.url);
  } catch (err) {
    logger.log('could not convert the tab to markdown', chromeTabId, err);
    return null;
  }
}

/** Test hook: run the conversion here, with no worker. */
export function setMarkdownRunnerForTest(runner: MarkdownRunner | null): void {
  injectedRunner = runner;
}
