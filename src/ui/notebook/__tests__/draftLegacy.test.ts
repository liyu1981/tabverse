import {
  draftRawToHtml,
  escapeHtml,
  isLegacyDraftData,
  normalizeNoteHtml,
} from '../draftLegacy';

const simpleRaw = {
  blocks: [
    {
      key: 'a',
      text: 'Hello world',
      type: 'unstyled',
      depth: 0,
      inlineStyleRanges: [{ offset: 0, length: 5, style: 'BOLD' }],
      entityRanges: [],
    },
  ],
  entityMap: {},
};

test('detects legacy draft data and rejects html/empty', () => {
  expect(isLegacyDraftData(JSON.stringify(simpleRaw))).toBe(true);
  expect(isLegacyDraftData('<p>already html</p>')).toBe(false);
  expect(isLegacyDraftData('')).toBe(false);
  expect(isLegacyDraftData('{ not json')).toBe(false);
  expect(isLegacyDraftData('{"foo":1}')).toBe(false);
});

test('converts a simple block with inline styles', () => {
  expect(draftRawToHtml(JSON.stringify(simpleRaw))).toBe(
    '<p><strong>Hello</strong> world</p>',
  );
});

test('converts headings, quotes and code blocks', () => {
  const raw = {
    blocks: [
      {
        key: '1',
        text: 'Title',
        type: 'header-one',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
      {
        key: '2',
        text: 'quoted',
        type: 'blockquote',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
      {
        key: '3',
        text: 'let x = 1',
        type: 'code-block',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
    ],
    entityMap: {},
  };
  expect(draftRawToHtml(JSON.stringify(raw))).toBe(
    '<h1>Title</h1><blockquote>quoted</blockquote><pre><code>let x = 1</code></pre>',
  );
});

test('groups consecutive list items into one list', () => {
  const raw = {
    blocks: [
      {
        key: '1',
        text: 'one',
        type: 'unordered-list-item',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
      {
        key: '2',
        text: 'two',
        type: 'unordered-list-item',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
      {
        key: '3',
        text: 'para',
        type: 'unstyled',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
      {
        key: '4',
        text: 'first',
        type: 'ordered-list-item',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
    ],
    entityMap: {},
  };
  expect(draftRawToHtml(JSON.stringify(raw))).toBe(
    '<ul><li>one</li><li>two</li></ul><p>para</p><ol><li>first</li></ol>',
  );
});

test('multiple styles on the same run nest correctly', () => {
  const raw = {
    blocks: [
      {
        key: 'a',
        text: 'abc',
        type: 'unstyled',
        depth: 0,
        inlineStyleRanges: [
          { offset: 0, length: 3, style: 'BOLD' },
          { offset: 1, length: 2, style: 'ITALIC' },
        ],
        entityRanges: [],
      },
    ],
    entityMap: {},
  };
  expect(draftRawToHtml(JSON.stringify(raw))).toBe(
    '<p><strong>a</strong><strong><em>bc</em></strong></p>',
  );
});

test('escapes html in note text', () => {
  const raw = {
    blocks: [
      {
        key: 'a',
        text: '<script>alert(1)</script>',
        type: 'unstyled',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [],
      },
    ],
    entityMap: {},
  };
  const html = draftRawToHtml(JSON.stringify(raw));
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(escapeHtml(`a&b'"<`)).toBe('a&amp;b&#39;&quot;&lt;');
});

test('link entities become anchors', () => {
  const raw = {
    blocks: [
      {
        key: 'a',
        text: 'go here',
        type: 'unstyled',
        depth: 0,
        inlineStyleRanges: [],
        entityRanges: [{ offset: 3, length: 4, key: 0 }],
      },
    ],
    entityMap: {
      '0': { type: 'LINK', data: { url: 'https://example.com/?a=1&b=2' } },
    },
  };
  expect(draftRawToHtml(JSON.stringify(raw))).toBe(
    '<p>go <a href="https://example.com/?a=1&amp;b=2" rel="noreferrer">here</a></p>',
  );
});

test('normalizeNoteHtml passes html through and converts legacy', () => {
  expect(normalizeNoteHtml('<p>x</p>')).toBe('<p>x</p>');
  expect(normalizeNoteHtml('')).toBe('');
  expect(normalizeNoteHtml(JSON.stringify(simpleRaw))).toBe(
    '<p><strong>Hello</strong> world</p>',
  );
});
