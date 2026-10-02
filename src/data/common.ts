import { nanoid } from 'nanoid';
import { produce } from 'immer';

/**
 * A durable id.
 *
 * Every record is born saved: a tabverse's id is minted by whoever opens it
 * and travels in the tab's url as `tvid`, and the records under it are given
 * their ids when they are created. There is no `~`-prefixed "not saved yet"
 * form and no id that changes on the first save - the unsaved-tabverse design
 * it replaced is gone, and with it the re-parenting its id change needed.
 */
export function getNewId() {
  // use 11 chars, as calculated by the estimator
  // (https://zelark.github.io/nano-id-cc/) this will result in ~1 thousand
  // years needed, in order to have a 1% probability of at least one collision
  // for 100 ids per hour.
  return nanoid(11);
}

/** tabSpaceId of a record that does not belong to any tabverse (it is a tab). */
export const NotTabSpaceId = '';

export interface IBase {
  version: number;
  id: string;
  createdAt: number;
  updatedAt: number;
}

export function setAttrForObject2<T1 = any, T2 = any>(
  attrName: string,
): (value: T1, target: T2) => T2 {
  return (value: T1, target: T2) => {
    return produce(target, (draft) => {
      draft[attrName] = value;
    });
  };
}

export function setAttrForObject<T1, T2>(
  attrName: string,
  value: T1,
  target: T2,
): T2 {
  return setAttrForObject2(attrName)(value, target);
}
