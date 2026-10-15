/**
 * Query reading for the manager page (`src/ui/common/queryAndHashParameter.ts`).
 *
 * The opener encodes what it puts in the url (`tabverseUrl`), a colour's `#`
 * included, so the reader decodes to hand back what was meant. The function
 * reads one member of `window`, which does not exist in the node test
 * environment, so the stub installs exactly that member.
 */
import { afterEach, expect, test } from 'vitest';

import { getQueryParameters } from '../queryAndHashParameter';

const globalWithWindow = globalThis as unknown as { window?: unknown };
const originalWindow = globalWithWindow.window;

afterEach(() => {
  globalWithWindow.window = originalWindow;
});

function withSearch(search: string): void {
  globalWithWindow.window = { location: { search } };
}

test('decodes the values the opener encoded', () => {
  withSearch('?op=new&tvid=x&color=%2354617a');
  expect(getQueryParameters()).toEqual({
    op: 'new',
    tvid: 'x',
    color: '#54617a',
  });
});

test('a malformed escape is left as it was written', () => {
  withSearch('?color=%');
  expect(getQueryParameters().color).toBe('%');
});

test('a value that contains an equals sign keeps the rest', () => {
  withSearch('?q=a=b');
  expect(getQueryParameters().q).toBe('a=b');
});

test('an empty search reads as no parameters', () => {
  withSearch('');
  expect(getQueryParameters()).toEqual({});
});
