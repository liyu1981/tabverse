/**
 * When a tab is photographed, and when it is not.
 *
 * A capture is a whole-window screenshot: Chrome renders and JPEG-encodes the
 * visible area, and the page keeps a base64 copy. The two rules under test are
 * what keeps that from happening on every title rewrite and every flick back
 * and forth between two tabs - which is what a long-lived manager page on a
 * busy window was doing.
 */
import {
  isPreviewWorthCapturing,
  resetPreviewCaptureThrottleForTest,
  shouldCapturePreview,
} from '../chromeTab';

beforeEach(() => {
  resetPreviewCaptureThrottleForTest();
});

test('the same tab is captured at most once per interval', () => {
  const now = 1_000_000;
  expect(shouldCapturePreview(7, now)).toBe(true);
  expect(shouldCapturePreview(7, now + 1_000)).toBe(false);
  expect(shouldCapturePreview(7, now + 11_000)).toBe(true);
});

test('the interval is per tab, not global', () => {
  const now = 1_000_000;
  expect(shouldCapturePreview(7, now)).toBe(true);
  expect(shouldCapturePreview(8, now)).toBe(true);
});

test('a tab that cannot be photographed is never due', () => {
  // a saved tab carries chromeTabId -1; tabs.update/capture cannot address it
  expect(shouldCapturePreview(-1, 1_000_000)).toBe(false);
});

test('only a navigation or a finished load is worth a capture', () => {
  expect(isPreviewWorthCapturing({ url: 'https://example.com/a' })).toBe(true);
  expect(
    isPreviewWorthCapturing({
      status: 'complete',
    } as chrome.tabs.OnUpdatedInfo),
  ).toBe(true);
  // a chat app rewriting its title every few seconds is not
  expect(isPreviewWorthCapturing({ title: 'new message' })).toBe(false);
  expect(isPreviewWorthCapturing({ favIconUrl: 'https://e.com/i.png' })).toBe(
    false,
  );
  expect(isPreviewWorthCapturing({})).toBe(false);
});
