import { setupMockChromeAnd2TabSpacesWithMonitoring } from './common.test';
import { updateTabSpaceName } from '../chromeTab';

test('onCreated', async () => {
  const { mockChrome, w1, w2, t1, t2, t3, t4, tst1, d1, tst2, d2 } =
    await setupMockChromeAnd2TabSpacesWithMonitoring();
  const d1tsNewName = d1.tabSpace.name + 'changed';
  updateTabSpaceName(d1.tabSpace, d1tsNewName);
  await mockChrome.flushMessages();
  expect(d1.tabSpace.name).toEqual(d1tsNewName);
  expect(d2.tabSpaceRegistry.registry.get(d1.tabSpace.id).name).toEqual(
    d1tsNewName,
  );
});
