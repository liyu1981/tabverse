import * as React from 'react';

import {
  TabSpaceOp,
  hasOwnProperty,
  isTabSpaceManagerPage,
  logger,
} from '../global';
import { TabSpaceRegistryMsg, sendChromeMessage } from '../message';
import {
  bootstrap as dataBootstrap,
  bootstrapFromTabSpaceId as dataBootstrapFromTabSpaceId,
  getTabSpaceData,
} from '../data/tabSpace/bootstrap';
import {
  getAllNoteData,
  bootstrap as noteBootstrap,
} from '../data/note/bootstrap';

import { CountExit } from './common/CountExit';
import { ManagerView } from './manager/ManagerView';
import { Note } from '../data/note/note';
import { strict as assert } from 'assert';
import { bootstrap as bookmarkBootstrap } from '../data/bookmark/bootstrap';
import { find } from 'lodash';
import { getQueryParameters } from './common/queryAndHashParameter';
import { renderPage } from './common/base';
import { bootstrap as storeBootstrap } from '../store/bootstrap';
import { bootstrap as todoBootstrap } from '../data/todo/bootstrap';

async function bootstrap() {
  const thisTab = await chrome.tabs.getCurrent();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tsTab = find(tabs, (tab: chrome.tabs.Tab) =>
    isTabSpaceManagerPage(tab),
  );
  if (tsTab && tsTab.id !== thisTab.id) {
    renderPage({
      pageComponent: (
        <CountExit message={'Found another Tabverse Manager page!'} />
      ),
    });
  } else {
    const queryParams = getQueryParameters();
    assert(
      hasOwnProperty(queryParams, 'op'),
      'queryParams do not have attribute op.',
    );

    storeBootstrap();

    switch (queryParams.op) {
      case TabSpaceOp.LoadSaved:
        await dataBootstrapFromTabSpaceId(
          queryParams.stsid,
          tsTab.id,
          tsTab.windowId,
        );
        getTabSpaceData().savedTabSpaceStore.updateLastSavedTime(
          getTabSpaceData().tabSpace.updatedAt,
        );
        break;
      default:
        await dataBootstrap(tsTab.id, tsTab.windowId);
    }

    await noteBootstrap(getTabSpaceData().tabSpace.id);
    await todoBootstrap(getTabSpaceData().tabSpace.id);
    await bookmarkBootstrap(getTabSpaceData().tabSpace.id);

    if (getAllNoteData().allNote.notes.size <= 0) {
      getAllNoteData().allNote.addNote(new Note());
    }

    await getTabSpaceData().savedTabSpaceStore.querySavedTabSpaceCount();

    sendChromeMessage({
      type: TabSpaceRegistryMsg.AddTabSpace,
      payload: getTabSpaceData().tabSpace.toTabSpaceStub(),
    });

    renderPage({
      pageComponent: (
        <div>
          <ManagerView
            queryParams={queryParams}
            tabSpaceData={getTabSpaceData()}
          />
        </div>
      ),
    });
  }

  chrome.tabs.getCurrent((tab) => {
    chrome.tabs.update(tab.id, { pinned: true });
  });
}

logger.log('Tabverse extension id:', chrome.runtime.id);

bootstrap();
