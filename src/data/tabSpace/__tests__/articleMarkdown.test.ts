/**
 * The HTML-to-Markdown conversion (`src/data/tabSpace/articleMarkdown.ts`).
 *
 * The fixture is a page with chrome around an article - a nav, a footer, a
 * script and a stylesheet - because the question this suite asks is not "does
 * Turndown work" but "does Readability leave the article and only the article".
 * It runs in the node environment, which is also a Web Worker's: no `window`,
 * no global `document`, and Turndown is handed a parsed node rather than a
 * string.
 */
import { describe, expect, test } from 'vitest';

import { htmlToMarkdown } from '../articleMarkdown';

const PAGE = `<!doctype html>
<html>
  <head>
    <title>The Page Title</title>
    <link rel="stylesheet" href="/site.css" />
    <script>window.__DATA__ = {"huge": true};</script>
  </head>
  <body>
    <nav><a href="/">Home</a> <a href="/about">About</a></nav>
    <article>
      <h1>A Long Enough Article</h1>
      <p>
        The first paragraph is the one that gives Readability a paragraph to
        score, and it is deliberately long enough to read as prose rather than
        as a caption. It has a <strong>bold</strong> word and an
        <em>italic</em> one.
      </p>
      <p>
        A relative link points at <a href="../guide">the guide</a>, and an
        image sits below it: <img src="images/diagram.png" alt="a diagram" />.
      </p>
      <h2>A list</h2>
      <ul><li>first</li><li>second</li></ul>
      <h2>A table</h2>
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>alpha</td><td>1</td></tr><tr><td>beta</td><td>2</td></tr></tbody>
      </table>
      <pre><code>const answer = 42;</code></pre>
    </article>
    <footer>Copyright 2026 - not part of the article</footer>
  </body>
</html>`;

describe('htmlToMarkdown', () => {
  test('keeps the article and drops the page chrome', () => {
    const article = htmlToMarkdown(PAGE, 'https://example.com/posts/one/');
    expect(article).not.toBeNull();
    const markdown = article?.markdown ?? '';
    expect(markdown).toMatch(/#{1,6} A Long Enough Article/);
    expect(markdown).toContain('**bold**');
    expect(markdown).toContain('*italic*');
    expect(markdown).toContain('first');
    expect(markdown).toContain('beta');
    expect(markdown).toContain('const answer = 42;');
    expect(markdown).not.toContain('Home');
    expect(markdown).not.toContain('Copyright');
    expect(markdown).not.toContain('__DATA__');
  });

  test('resolves relative links and images against the base url', () => {
    const article = htmlToMarkdown(PAGE, 'https://example.com/posts/one/');
    expect(article?.markdown).toContain('https://example.com/posts/guide');
    expect(article?.markdown).toContain(
      'https://example.com/posts/one/images/diagram.png',
    );
  });

  test('writes a GFM table', () => {
    const article = htmlToMarkdown(PAGE, 'https://example.com/posts/one/');
    expect(article?.markdown).toMatch(/\|\s*Name\s*\|\s*Value\s*\|/);
    expect(article?.markdown).toMatch(/\|\s*alpha\s*\|\s*1\s*\|/);
  });

  test('reports a title', () => {
    const article = htmlToMarkdown(PAGE, 'https://example.com/posts/one/');
    expect(article?.title).toBeTruthy();
  });

  test('falls back to the whole body when there is no article', () => {
    const article = htmlToMarkdown(
      '<!doctype html><html><body><div>Just one line.</div></body></html>',
      'https://example.com/',
    );
    expect(article?.markdown).toContain('Just one line.');
  });

  test('an empty document is null', () => {
    expect(htmlToMarkdown('', 'https://example.com/')).toBeNull();
    expect(
      htmlToMarkdown('<!doctype html><html><body></body></html>', ''),
    ).toBeNull();
  });
});
