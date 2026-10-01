import {
  getPreview,
  newEmptyTabPreviewCache,
  removePreview,
  setPreview,
} from '../TabPreviewCache';

// No thumbnail is a normal state, not something to dress up: the previews are a
// local cache (data/tabSpace/previewReaper), so "not captured yet" comes back as
// '' and the card renders without a picture. It used to be a dummyimage.com
// URL, which made a hover fetch a picture from a third party.
test('a tab without a thumbnail has none, rather than a placeholder image', () => {
  let tp = newEmptyTabPreviewCache();
  expect(getPreview(1000, tp)).toBe('');
  tp = setPreview(1000, 'data123', tp);
  expect(getPreview(1000, tp)).toBe('data123');
  tp = removePreview(1000, tp);
  expect(getPreview(1000, tp)).toBe('');
});
