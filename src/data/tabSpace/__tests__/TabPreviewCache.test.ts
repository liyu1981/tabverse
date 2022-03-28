import {
  getPreview,
  newEmptyTabPreviewCache,
  removePreview,
  setPreview,
} from '../TabPreviewCache';

test('all', () => {
  let tp = newEmptyTabPreviewCache();
  expect(
    getPreview(1000, tp).startsWith('https://dummyimage.com'),
  ).toBeTruthy();
  tp = setPreview(1000, 'data123', tp);
  expect(getPreview(1000, tp)).toBe('data123');
  tp = removePreview(1000, tp);
  expect(
    getPreview(1000, tp).startsWith('https://dummyimage.com'),
  ).toBeTruthy();
});
