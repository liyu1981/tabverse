/**
 * The scaling rule for a captured thumbnail, as pure geometry - the decoding
 * and the canvas are browser-only and cannot run here (ADR 0019), so the tests
 * pin the part that decides what size the stored picture is, and that a
 * capture that cannot be shrunk is handed back untouched.
 */
import {
  PREVIEW_MAX_WIDTH,
  previewTargetSize,
  shrinkPreview,
} from '../tabPreviewImage';

test('a capture narrower than the target is left at its own size', () => {
  expect(previewTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
  expect(previewTargetSize(PREVIEW_MAX_WIDTH, 200)).toEqual({
    width: PREVIEW_MAX_WIDTH,
    height: 200,
  });
});

test('a wide capture is scaled to the target width, keeping the aspect ratio', () => {
  expect(previewTargetSize(2560, 1440)).toEqual({ width: 1024, height: 576 });
  expect(previewTargetSize(1920, 1080)).toEqual({ width: 1024, height: 576 });
  // a very wide, very short capture never rounds the height away
  expect(previewTargetSize(4000, 10)).toEqual({ width: 1024, height: 3 });
});

test('a capture with no size is not scaled into nonsense', () => {
  expect(previewTargetSize(0, 0)).toEqual({ width: 0, height: 0 });
  expect(previewTargetSize(-1, 100)).toEqual({ width: 0, height: 0 });
});

test('without a canvas (the tests, the worker) a capture is kept as it is', async () => {
  const dataUrl = 'data:image/jpeg;base64,AAA';
  await expect(shrinkPreview(dataUrl)).resolves.toBe(dataUrl);
});

test('a non-image string is never handed to the decoder', async () => {
  await expect(shrinkPreview('not a data url')).resolves.toBe('not a data url');
  await expect(shrinkPreview('')).resolves.toBe('');
});
