import { isEqual } from 'lodash';

import { Map } from 'immutable';
import { TabSpace } from '../tabSpace/TabSpace';

export type TabSpaceStub = Omit<TabSpace, 'tabs'>;
export type TabSpaceRegistry = Map<string, TabSpaceStub>;
export type TabSpaceRegistryChange = {
  from: string;
  to: string;
  entry: TabSpaceStub;
};
export type TabSpaceRegistryInArray = { [k: string]: TabSpaceStub };

export function newEmptyTabSpaceRegistry(): TabSpaceRegistry {
  return Map();
}

export function cloneTabSpaceRegistry(
  targetTabSpaceRegistry: TabSpaceRegistry,
): TabSpaceRegistry {
  return Map(targetTabSpaceRegistry);
}

export function toTabSpaceRegistryInArray(
  targetTabSpaceRegistry: TabSpaceRegistry,
): TabSpaceRegistryInArray {
  return targetTabSpaceRegistry.toJS();
}

export function fromTabSpaceRegistryInArray(
  TabSpaceRegistryInArray: TabSpaceRegistryInArray,
) {
  return Map(TabSpaceRegistryInArray);
}

export function toMsgPayload(
  tabSpaceRegistry: TabSpaceRegistry,
): TabSpaceStub[] {
  return tabSpaceRegistry.toList().toArray();
}

export function addTabSpaceStub(
  entry: TabSpaceStub,
  targetTabSpaceRegistry: TabSpaceRegistry,
): TabSpaceRegistry {
  if (targetTabSpaceRegistry.has(entry.id)) {
    const thisEntry = targetTabSpaceRegistry.get(entry.id);
    if (!isEqual(thisEntry, entry)) {
      return targetTabSpaceRegistry.set(entry.id, entry);
    }
    return cloneTabSpaceRegistry(targetTabSpaceRegistry);
  } else {
    return targetTabSpaceRegistry.set(entry.id, entry);
  }
}

export function removeTabSpaceStub(
  tabSpaceId: string,
  targetTabSpaceRegistry: TabSpaceRegistry,
): TabSpaceRegistry {
  if (targetTabSpaceRegistry.has(tabSpaceId)) {
    return targetTabSpaceRegistry.remove(tabSpaceId);
  } else {
    return cloneTabSpaceRegistry(targetTabSpaceRegistry);
  }
}

export function removeTabSpaceByChromeTabId(
  chromeTabId: number,
  targetTabSpaceRegistry: TabSpaceRegistry,
): TabSpaceRegistry {
  const id = targetTabSpaceRegistry.findKey(
    (entry) => entry.chromeTabId === chromeTabId,
  );
  if (id) {
    return targetTabSpaceRegistry.remove(id);
  } else {
    return cloneTabSpaceRegistry(targetTabSpaceRegistry);
  }
}

export function filter(
  predicate: (entry: TabSpaceStub) => boolean,
  targetTabSpaceRegistry: TabSpaceRegistry,
): TabSpaceRegistry {
  return targetTabSpaceRegistry.filter(predicate).toMap();
}

export function mergeRegistry(
  msgPayload: TabSpaceStub[],
  targetTabSpaceRegistry: TabSpaceRegistry,
): { tabSpaceRegistry: TabSpaceRegistry; changed: boolean } {
  let changed = false;
  let newTabSpaceRegistry = cloneTabSpaceRegistry(targetTabSpaceRegistry);
  msgPayload.forEach((tabSpaceStub) => {
    if (newTabSpaceRegistry.has(tabSpaceStub.id)) {
      const thisTabSpace = newTabSpaceRegistry.get(tabSpaceStub.id);
      if (!isEqual(thisTabSpace, tabSpaceStub)) {
        newTabSpaceRegistry = newTabSpaceRegistry.set(
          tabSpaceStub.id,
          tabSpaceStub,
        );
        changed = true;
      }
    } else {
      newTabSpaceRegistry = newTabSpaceRegistry.set(
        tabSpaceStub.id,
        tabSpaceStub,
      );
      changed = true;
    }
  });
  return { tabSpaceRegistry: newTabSpaceRegistry, changed };
}

export function mergeRegistryChanges(
  changes: TabSpaceRegistryChange[],
  targetTabSpaceRegistry: TabSpaceRegistry,
): { tabSpaceRegistry: TabSpaceRegistry; changed: boolean } {
  let changed = false;
  let newTabSpaceRegistry = cloneTabSpaceRegistry(targetTabSpaceRegistry);
  changes.forEach(({ from, to, entry }) => {
    if (from !== to) {
      newTabSpaceRegistry = newTabSpaceRegistry.remove(from).set(to, entry);
      changed = true;
    } else {
      if (newTabSpaceRegistry.has(to)) {
        const thisEntry = newTabSpaceRegistry.get(to);
        if (!isEqual(thisEntry, entry)) {
          newTabSpaceRegistry = newTabSpaceRegistry.set(to, entry);
          changed = true;
        }
      } else {
        newTabSpaceRegistry = newTabSpaceRegistry.set(to, entry);
        changed = true;
      }
    }
  });
  return { tabSpaceRegistry: newTabSpaceRegistry, changed };
}

export function findTabSpaceIdByChromeTabId(
  chromeTabId: number,
  targetTabSpaceRegistry: TabSpaceRegistry,
): string {
  return targetTabSpaceRegistry.findKey(
    (entry) => entry.chromeTabId === chromeTabId,
  );
}
