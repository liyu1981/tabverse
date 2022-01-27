import { TabPreview } from '../TabPreview';

test('all', () => {
  const tp = new TabPreview();
  expect(tp.getPreview(1000).startsWith('https://dummyimage.com')).toBeTruthy();
  tp.setPreview(1000, 'data123');
  expect(tp.getPreview(1000)).toBe('data123');
  tp.removePreview(1000);
  expect(tp.getPreview(1000).startsWith('https://dummyimage.com')).toBeTruthy();
});
