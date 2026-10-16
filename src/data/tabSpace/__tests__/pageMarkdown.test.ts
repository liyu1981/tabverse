/**
 * Converting a tab to Markdown (`src/data/tabSpace/pageMarkdown.ts`).
 *
 * The browser and the worker are both injected, so this pins the wiring - the
 * extractor is handed the tab id and its answer goes to the runner - and the
 * failure behaviour: an unreadable tab is null, a runner that throws is null,
 * and a non-positive id reaches neither.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  convertTabToMarkdown,
  setMarkdownRunnerForTest,
} from '../pageMarkdown';
import { setTabHtmlExtractorForTest } from '../tabText';

afterEach(() => {
  setMarkdownRunnerForTest(null);
  setTabHtmlExtractorForTest(null);
});

describe('convertTabToMarkdown', () => {
  test('reads the tab and runs the conversion on its markup', async () => {
    setTabHtmlExtractorForTest(async () => ({
      html: '<html><body><p>page</p></body></html>',
      url: 'https://example.com/a/',
    }));
    const runner = vi.fn(async () => ({
      title: 'Page',
      byline: '',
      siteName: '',
      excerpt: '',
      markdown: '# Page',
    }));
    setMarkdownRunnerForTest(runner);

    await expect(convertTabToMarkdown(7)).resolves.toEqual({
      title: 'Page',
      byline: '',
      siteName: '',
      excerpt: '',
      markdown: '# Page',
    });
    expect(runner).toHaveBeenCalledWith(
      '<html><body><p>page</p></body></html>',
      'https://example.com/a/',
    );
  });

  test('an unreadable tab never reaches the runner', async () => {
    setTabHtmlExtractorForTest(async () => null);
    const runner = vi.fn(async () => null);
    setMarkdownRunnerForTest(runner);
    await expect(convertTabToMarkdown(7)).resolves.toBeNull();
    expect(runner).not.toHaveBeenCalled();
  });

  test('a runner that fails is null, never a throw', async () => {
    setTabHtmlExtractorForTest(async () => ({ html: '<p>x</p>', url: '' }));
    setMarkdownRunnerForTest(async () => {
      throw new Error('the worker died');
    });
    await expect(convertTabToMarkdown(7)).resolves.toBeNull();
  });

  test('a non-positive id never reaches the extractor', async () => {
    const extractor = vi.fn(async () => ({ html: '<p>x</p>', url: '' }));
    setTabHtmlExtractorForTest(extractor);
    await expect(convertTabToMarkdown(-1)).resolves.toBeNull();
    await expect(convertTabToMarkdown(0)).resolves.toBeNull();
    expect(extractor).not.toHaveBeenCalled();
  });
});
