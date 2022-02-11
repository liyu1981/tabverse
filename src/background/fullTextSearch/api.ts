import { FullTextSearchMsg, sendChromeMessage } from '../../message';
import { SearchableType } from './addToIndex';

export function addTabSpaceToIndex(tabSpaceId: string) {
  sendChromeMessage({
    type: FullTextSearchMsg.AddToIndex,
    payload: { type: SearchableType.TabSpace, id: tabSpaceId },
  });
}

export function removeTabSpaceFromIndex(tabSpaceId: string) {
  sendChromeMessage({
    type: FullTextSearchMsg.RemoveFromIndex,
    payload: { type: SearchableType.TabSpace, id: tabSpaceId },
  });
}
