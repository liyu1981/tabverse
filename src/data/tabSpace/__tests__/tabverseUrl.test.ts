/**
 * A tabverse is born saved: the id is minted when the tab is opened and travels
 * in the url as `tvid`, so opening a Tabverse tab is the same act as deciding to
 * keep the window's tabs.
 */
import { TabSpaceOp } from '../../../global';
import { tabverseUrl } from '../chromeUtil';

test('a new tabverse url carries a durable id', () => {
  const url = tabverseUrl(TabSpaceOp.New);
  expect(url).toMatch(/^manager\.html\?op=new&tvid=/);

  const tvid = new URL(url, 'https://x/').searchParams.get('tvid');
  expect(tvid).toBeTruthy();
});

test('the id is url encoded and never blank', () => {
  const url = tabverseUrl(TabSpaceOp.LoadSaved, 'abc/def+ghi');
  const tvid = new URL(url, 'https://x/').searchParams.get('tvid');
  expect(tvid).toBe('abc/def+ghi');
  expect(url).not.toContain('&tvid=&');
});

test('each new tabverse gets its own id', () => {
  const ids = new Set(
    Array.from({ length: 50 }, () => tabverseUrl(TabSpaceOp.New)),
  );
  expect(ids.size).toBe(50);
});

test('a new tabverse can carry its rail colour, encoded', () => {
  const url = tabverseUrl(TabSpaceOp.New, undefined, '#724389');
  // the `#` would otherwise start the fragment, so it is percent-encoded and
  // must read back as the colour the opener meant
  expect(url).toContain('color=%23724389');
  const color = new URL(url, 'https://x/').searchParams.get('color');
  expect(color).toBe('#724389');
});

test('a saved tabverse carries no colour: its own record has it', () => {
  expect(tabverseUrl(TabSpaceOp.LoadSaved, 'abc')).not.toContain('color=');
});
