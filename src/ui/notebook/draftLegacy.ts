/**
 * Legacy note format support.
 *
 * Notes used to store draft-js `RawDraftContentState` JSON in `note.data`.
 * The editor is now TipTap, which stores HTML. This module converts old
 * content once, on read, so existing notes keep working: the next save
 * persists HTML.
 */

interface RawInlineRange {
  offset: number;
  length: number;
  style: string;
}

interface RawEntityRange {
  offset: number;
  length: number;
  key: number;
}

interface RawBlock {
  key: string;
  text: string;
  type: string;
  depth: number;
  inlineStyleRanges: RawInlineRange[];
  entityRanges: RawEntityRange[];
}

interface RawEntity {
  type: string;
  data?: { [k: string]: any };
}

interface RawDraftContentState {
  blocks: RawBlock[];
  entityMap: { [k: string]: RawEntity };
}

/** Inline styles draft-js produced, mapped to HTML tags (open/close pairs). */
const STYLE_TAGS: Record<string, [string, string]> = {
  BOLD: ['<strong>', '</strong>'],
  ITALIC: ['<em>', '</em>'],
  UNDERLINE: ['<u>', '</u>'],
  CODE: ['<code>', '</code>'],
  STRIKETHROUGH: ['<s>', '</s>'],
};

// order matters only for deterministic output
const STYLE_ORDER = ['BOLD', 'ITALIC', 'UNDERLINE', 'CODE', 'STRIKETHROUGH'];

const BLOCK_TAGS: Record<string, string> = {
  unstyled: 'p',
  'header-one': 'h1',
  'header-two': 'h2',
  'header-three': 'h3',
  blockquote: 'blockquote',
  'code-block': 'pre',
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * True when `data` looks like a draft-js raw document rather than HTML.
 * Exported so the note view can decide per note without guessing.
 */
export function isLegacyDraftData(data: string): boolean {
  const trimmed = (data || '').trim();
  if (!trimmed.startsWith('{')) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return (
      !!parsed &&
      Array.isArray((parsed as RawDraftContentState).blocks) &&
      typeof (parsed as RawDraftContentState).entityMap === 'object'
    );
  } catch {
    return false;
  }
}

/**
 * Renders one raw block's text with its inline styles and entities.
 * Runs are emitted by reopening the tag set whenever it changes, which keeps
 * the output valid without nesting bookkeeping.
 */
function renderInline(block: RawBlock, entityMap: Record<string, RawEntity>) {
  const text = block.text || '';
  if (text.length === 0) {
    return '';
  }

  // active style tags (and optional wrapper) per character
  const activeAt: string[][] = Array.from({ length: text.length }, () => []);
  for (const range of block.inlineStyleRanges || []) {
    if (!STYLE_TAGS[range.style]) {
      continue;
    }
    for (let i = range.offset; i < range.offset + range.length; i++) {
      if (i >= 0 && i < text.length) {
        activeAt[i].push(range.style);
      }
    }
  }

  // entity (link) ranges wrap their span
  const entityOpen: Record<number, string> = {};
  const entityClose: Record<number, string> = {};
  for (const range of block.entityRanges || []) {
    const entity = entityMap && entityMap[String(range.key)];
    if (!entity) {
      continue;
    }
    if (entity.type === 'LINK') {
      const href = escapeHtml(entity.data?.url || entity.data?.href || '#');
      entityOpen[range.offset] = `<a href="${href}" rel="noreferrer">`;
      entityClose[range.offset + range.length] = '</a>';
    }
  }

  let out = '';
  let openTagSet = '';
  for (let i = 0; i < text.length; i++) {
    const styles = STYLE_ORDER.filter((s) => activeAt[i].includes(s));
    const tagSet = styles.join(',');
    if (tagSet !== openTagSet) {
      // close everything, then reopen: always valid regardless of ordering
      const previous = openTagSet === '' ? [] : openTagSet.split(',');
      for (const style of previous.slice().reverse()) {
        out += STYLE_TAGS[style][1];
      }
      for (const style of styles) {
        out += STYLE_TAGS[style][0];
      }
      openTagSet = tagSet;
    }
    // boundaries are positions *between* characters: close before this char,
    // open before this char, then emit the char itself
    if (entityClose[i]) {
      out += entityClose[i];
    }
    if (entityOpen[i]) {
      out += entityOpen[i];
    }
    out += escapeHtml(text[i]);
  }
  // a link running to the end of the line closes after the last character
  if (entityClose[text.length]) {
    out += entityClose[text.length];
  }
  for (const style of openTagSet.split(',').reverse()) {
    if (style) {
      out += STYLE_TAGS[style][1];
    }
  }
  return out;
}

function renderBlock(
  block: RawBlock,
  entityMap: Record<string, RawEntity>,
): string {
  const body = renderInline(block, entityMap);

  if (
    block.type === 'unordered-list-item' ||
    block.type === 'ordered-list-item'
  ) {
    // list items are grouped by the caller
    return `<li>${body}</li>`;
  }
  if (block.type === 'code-block') {
    return `<pre><code>${escapeHtml(block.text || '')}</code></pre>`;
  }
  const tag = BLOCK_TAGS[block.type] || 'p';
  return `<${tag}>${body || '<br/>'}</${tag}>`;
}

/**
 * Converts legacy draft-js raw JSON into HTML (the note format TipTap keeps).
 * Output is intentionally plain: paragraphs, headings, quotes, lists, code
 * blocks, bold/italic/underline/strike/code and links.
 */
export function draftRawToHtml(data: string): string {
  let parsed: RawDraftContentState;
  try {
    parsed = JSON.parse(data) as RawDraftContentState;
  } catch {
    return '';
  }
  if (!parsed || !Array.isArray(parsed.blocks)) {
    return '';
  }
  const entityMap = parsed.entityMap || {};
  const parts: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      parts.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const block of parsed.blocks) {
    const type = block.type;
    if (type === 'unordered-list-item' || type === 'ordered-list-item') {
      const wanted = type === 'unordered-list-item' ? 'ul' : 'ol';
      if (listType !== wanted) {
        closeList();
        parts.push(`<${wanted}>`);
        listType = wanted;
      }
      parts.push(renderBlock(block, entityMap));
      continue;
    }
    closeList();
    parts.push(renderBlock(block, entityMap));
  }
  closeList();
  return parts.join('');
}

/**
 * Normalizes whatever `note.data` holds into HTML: legacy draft content is
 * converted, everything else (HTML or empty) passes through.
 */
export function normalizeNoteHtml(data: string): string {
  if (!data) {
    return '';
  }
  if (isLegacyDraftData(data)) {
    return draftRawToHtml(data);
  }
  return data;
}
