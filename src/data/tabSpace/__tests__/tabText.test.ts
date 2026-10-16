/**
 * Reading a tab's text (`src/data/tabSpace/tabText.ts`).
 *
 * The browser is injected, so the cap and the failure modes are pinned here:
 * a too-long page is cut, an unreadable tab (a `chrome://` page, a tab that
 * went away) returns null rather than throwing, and a non-positive id never
 * reaches the extractor.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  MAX_TAB_TEXT_CHARS,
  capTabText,
  extractTabHtml,
  extractTabText,
  setTabHtmlExtractorForTest,
  setTabTextExtractorForTest,
} from '../tabText';

afterEach(() => {
  setTabTextExtractorForTest(null);
  setTabHtmlExtractorForTest(null);
});

describe('capTabText', () => {
  test('keeps short text as it is', () => {
    expect(capTabText('hello')).toBe('hello');
  });

  test('cuts long text to the cap', () => {
    expect(capTabText('x'.repeat(MAX_TAB_TEXT_CHARS + 10)).length).toBe(
      MAX_TAB_TEXT_CHARS,
    );
  });

  test('takes a custom cap', () => {
    expect(capTabText('abcdef', 3)).toBe('abc');
  });
});

describe('extractTabText', () => {
  test('returns the page text, capped', async () => {
    const extractor = vi.fn(async () => 'page text');
    setTabTextExtractorForTest(extractor);
    await expect(extractTabText(7)).resolves.toBe('page text');
    expect(extractor).toHaveBeenCalledWith(7);
  });

  test('caps what the page returns', async () => {
    setTabTextExtractorForTest(async () => 'x'.repeat(MAX_TAB_TEXT_CHARS + 5));
    await expect(extractTabText(7)).resolves.toHaveLength(MAX_TAB_TEXT_CHARS);
  });

  test('an unreadable tab is null', async () => {
    setTabTextExtractorForTest(async () => null);
    await expect(extractTabText(7)).resolves.toBeNull();
  });

  test('a failed injection is null, never a throw', async () => {
    setTabTextExtractorForTest(async () => {
      throw new Error('cannot inject here');
    });
    await expect(extractTabText(7)).resolves.toBeNull();
  });

  test('a non-positive id never reaches the extractor', async () => {
    const extractor = vi.fn(async () => 'text');
    setTabTextExtractorForTest(extractor);
    await expect(extractTabText(-1)).resolves.toBeNull();
    await expect(extractTabText(0)).resolves.toBeNull();
    expect(extractor).not.toHaveBeenCalled();
  });
});

describe('extractTabHtml', () => {
  test('returns the page markup and its base url', async () => {
    const extractor = vi.fn(async () => ({
      html: '<html><body>hi</body></html>',
      url: 'https://example.com/a/',
    }));
    setTabHtmlExtractorForTest(extractor);
    await expect(extractTabHtml(7)).resolves.toEqual({
      html: '<html><body>hi</body></html>',
      url: 'https://example.com/a/',
    });
    expect(extractor).toHaveBeenCalledWith(7);
  });

  test('an unreadable tab is null', async () => {
    setTabHtmlExtractorForTest(async () => null);
    await expect(extractTabHtml(7)).resolves.toBeNull();
  });

  test('a failed injection is null, never a throw', async () => {
    setTabHtmlExtractorForTest(async () => {
      throw new Error('cannot inject here');
    });
    await expect(extractTabHtml(7)).resolves.toBeNull();
  });

  test('a non-positive id never reaches the extractor', async () => {
    const extractor = vi.fn(async () => ({ html: '<p>x</p>', url: '' }));
    setTabHtmlExtractorForTest(extractor);
    await expect(extractTabHtml(-1)).resolves.toBeNull();
    await expect(extractTabHtml(0)).resolves.toBeNull();
    expect(extractor).not.toHaveBeenCalled();
  });
});
