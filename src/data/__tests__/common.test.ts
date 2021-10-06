import { Base, getUnsavedNewId } from '../common';

test('base immutable', () => {
  const b = new Base(getUnsavedNewId());
  b.makeImmutable();
  expect(() => {
    b.id = getUnsavedNewId();
  }).toThrowError();
});
