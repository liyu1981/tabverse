/**
 * The worker that turns one page into Markdown.
 *
 * `pageMarkdown.ts` creates it per run and terminates it when the answer (or a
 * timeout) arrives, so it holds nothing between conversions - no stale page, no
 * leaked context. The whole conversion is `htmlToMarkdown`, which is why this
 * file has no test of its own: there is nothing here to test that the pure
 * function does not already cover.
 *
 * `self` is reached through a cast rather than the `webworker` lib: the
 * tsconfig's `lib` is `dom`, and adding the worker lib next to it makes the two
 * declare conflicting globals.
 */
import { htmlToMarkdown, type MarkdownArticle } from './articleMarkdown';

interface MarkdownRequest {
  html: string;
  url: string;
}

export type MarkdownResponse =
  | { ok: true; article: MarkdownArticle | null }
  | { ok: false; error: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<MarkdownRequest>) => void) | null;
  postMessage: (message: MarkdownResponse) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    scope.postMessage({
      ok: true,
      article: htmlToMarkdown(event.data.html, event.data.url),
    });
  } catch (err) {
    scope.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
