/**
 * A tabverse is born saved: the id is minted when the tab is opened and travels
 * in the url as `tvid`, so opening a Tabverse tab is the same act as deciding to
 * keep the window's tabs.
 */
import { getNewId, getUnsavedNewId, isIdNotSaved } from '../../common';
import { TabSpaceOp } from '../../../global';
import { tabverseUrl } from '../chromeUtil';

test('a new tabverse url carries a durable id', () => {
  const url = tabverseUrl(TabSpaceOp.New);
  expect(url).toMatch(/^manager\.html\?op=new&tvid=/);

  const tvid = new URL(url, 'https://x/').searchParams.get('tvid');
  expect(tvid).toBeTruthy();
  expect(isIdNotSaved(tvid!)).toBe(false);
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

test('getNewId is durable while getUnsavedNewId is not', () => {
  expect(isIdNotSaved(getNewId())).toBe(false);
  expect(isIdNotSaved(getUnsavedNewId())).toBe(true);
});
