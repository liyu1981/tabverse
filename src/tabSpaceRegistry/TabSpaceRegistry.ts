import { action, makeObservable, observable } from 'mobx';
import { clone, forEach, isEqual } from 'lodash';

import { Map } from 'immutable';
import { TabSpaceJSON } from '../data/tabSpace/TabSpace';

export type TabSpaceStub = Omit<TabSpaceJSON, 'tabs'>;
export type TabSpaceRegistryMap = Map<string, TabSpaceStub>;
export type TabSpaceRegistryChange = {
  from: string;
  to: string;
  entry: TabSpaceStub;
};
export type TabSpaceRegistryJSON = { [k: string]: TabSpaceStub };

export class TabSpaceRegistry {
  registry: TabSpaceRegistryMap;

  constructor(registry?: TabSpaceRegistryMap) {
    this.registry = registry ? Map(registry) : Map();

    makeObservable(this, {
      registry: observable,

      add: action,
      remove: action,
      removeByChromeTabId: action,
      mergeRegistry: action,
      mergeRegistryChanges: action,
      replaceFromJSON: action,
    });
  }

  clone() {
    return new TabSpaceRegistry(this.registry);
  }

  toJSON(): { [k: string]: TabSpaceStub } {
    return this.registry.toJS();
  }

  toMsgPayload(): TabSpaceStub[] {
    return this.registry.toList().toArray();
  }

  add(entry: TabSpaceStub): TabSpaceRegistry {
    if (this.registry.has(entry.id)) {
      const thisEntry = this.registry.get(entry.id);
      if (!isEqual(thisEntry, entry)) {
        this.registry = this.registry.set(
          entry.id,
          Object.freeze(clone(entry)),
        );
      }
    } else {
      this.registry = this.registry.set(entry.id, Object.freeze(clone(entry)));
    }
    return this;
  }

  remove(tabSpaceId: string): TabSpaceRegistry {
    if (this.registry.has(tabSpaceId)) {
      this.registry = this.registry.remove(tabSpaceId);
    }
    return this;
  }

  removeByChromeTabId(chromeTabId: number): TabSpaceRegistry {
    const id = this.registry.findKey(
      (entry) => entry.chromeTabId === chromeTabId,
    );
    if (id) {
      return this.remove(id);
    }
    return this;
  }

  filter(predicate: (entry: TabSpaceStub) => boolean): TabSpaceRegistry {
    const newTabSpaceStud = this.clone();
    newTabSpaceStud.registry = Map<string, TabSpaceStub>(
      newTabSpaceStud.registry.filter(predicate),
    );
    return newTabSpaceStud;
  }

  mergeRegistry(msgPayload: TabSpaceStub[]) {
    let changed = false;
    forEach(msgPayload, (tabSpaceStub) => {
      if (this.registry.has(tabSpaceStub.id)) {
        const thisTabSpace = this.registry.get(tabSpaceStub.id);
        if (!isEqual(thisTabSpace, tabSpaceStub)) {
          this.registry = this.registry.set(
            tabSpaceStub.id,
            Object.freeze(clone(tabSpaceStub)),
          );
          changed = true;
        }
      } else {
        this.registry = this.registry.set(
          tabSpaceStub.id,
          Object.freeze(clone(tabSpaceStub)),
        );
        changed = true;
      }
    });
    return changed;
  }

  mergeRegistryChanges(changes: TabSpaceRegistryChange[]): boolean {
    let changed = false;
    forEach(changes, (change) => {
      const { from, to, entry } = change;
      if (from !== to) {
        this.registry = this.registry
          .remove(from)
          .set(to, Object.freeze(clone(entry)));
        changed = true;
      } else {
        if (this.registry.has(to)) {
          const thisEntry = this.registry.get(to);
          if (!isEqual(thisEntry, entry)) {
            this.registry = this.registry.set(to, Object.freeze(clone(entry)));
            changed = true;
          }
        } else {
          this.registry = this.registry.set(to, Object.freeze(clone(entry)));
          changed = true;
        }
      }
    });
    return changed;
  }

  findTabIdByChromeTabId(tabId: number): string {
    return this.registry.findKey((entry) => entry.chromeTabId === tabId);
  }

  replaceFromJSON(tabSpaceRegistryJSON: TabSpaceRegistryJSON) {
    this.registry = Map(tabSpaceRegistryJSON);
  }
}
