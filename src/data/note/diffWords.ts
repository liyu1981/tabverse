import { diffWords, diffWordsWithSpace } from 'diff';

/**
 * Word-level refinement for one paired line of the review diff.
 *
 * A changed line is usually a small edit to otherwise identical text, so the
 * dialog highlights the words that moved rather than the whole line. The
 * result carries one segment list per side; a segment is `changed` when the
 * token was removed (left) or added (right).
 *
 * CJK goes through `Intl.Segmenter`, which knows where words end; latin and code
 * runs use the whitespace-aware variant, which keeps indentation changes
 * visible. The results are cached because the dialog re-renders on every
 * keystroke.
 */

interface WordSegment {
  text: string;
  changed: boolean;
}

export interface WordDiffPair {
  left: WordSegment[];
  right: WordSegment[];
}

/** Lines longer than this skip word diffing to keep the dialog responsive. */
const MAX_LINE_LENGTH = 2000;
const CACHE_LIMIT = 500;
const cache = new Map<string, WordDiffPair | null>();

const CJK =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

let wordSegmenter: Intl.Segmenter | null | undefined;

function getWordSegmenter(): Intl.Segmenter | null {
  if (wordSegmenter === undefined) {
    wordSegmenter =
      typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null;
  }

  return wordSegmenter;
}

function compute(left: string, right: string): WordDiffPair | null {
  if (left === right) {
    return null;
  }

  if (left.length > MAX_LINE_LENGTH || right.length > MAX_LINE_LENGTH) {
    return null;
  }

  const segmenter = getWordSegmenter();
  const changes =
    segmenter !== null && (CJK.test(left) || CJK.test(right))
      ? diffWords(left, right, { intlSegmenter: segmenter })
      : diffWordsWithSpace(left, right);

  const leftSegments: WordSegment[] = [];
  const rightSegments: WordSegment[] = [];

  for (const change of changes) {
    if (change.added) {
      rightSegments.push({ text: change.value, changed: true });
    } else if (change.removed) {
      leftSegments.push({ text: change.value, changed: true });
    } else {
      leftSegments.push({ text: change.value, changed: false });
      rightSegments.push({ text: change.value, changed: false });
    }
  }

  if (
    !leftSegments.some((segment) => segment.changed) &&
    !rightSegments.some((segment) => segment.changed)
  ) {
    return null;
  }

  return { left: leftSegments, right: rightSegments };
}

export function wordDiff(left: string, right: string): WordDiffPair | null {
  const key = `${left}\u0000${right}`;
  const cached = cache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const result = compute(left, right);

  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }

  cache.set(key, result);

  return result;
}
