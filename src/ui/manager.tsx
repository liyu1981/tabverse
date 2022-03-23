import { IManagerQueryParams, ManagerView } from './manager/ManagerView';
import {
  TabSpaceOp,
  hasOwnProperty,
  isTabSpaceManagerPage,
  logger,
} from '../global';
import {
  bootstrap as dataBootstrap,
  bootstrapFromTabSpaceId as dataBootstrapFromTabSpaceId,
  getTabSpaceData,
} from '../data/tabSpace/bootstrap';

import { CountExit } from './common/CountExit';
import React from 'react';
import { strict as assert } from 'assert';
import { bootstrap as bookmarkBootstrap } from '../data/bookmark/bootstrap';
import { find } from 'lodash';
import { bootstrap as fullTextSearchBootstrap } from '../fullTextSearch';
import { getQueryParameters } from './common/queryAndHashParameter';
import { localStorageInit } from '../store/localStorageWrapper';
import { renderPage } from './common/base';
import { bootstrap as savedChromeSessionBootstrap } from '../data/chromeSession/bootstrap';
import { bootstrap as storeBootstrap } from '../store/bootstrap';
import { bootstrap as tabSpaceRegistryServiceBootstrap } from '../tabSpaceRegistry';

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

    tabSpaceRegistryServiceBootstrap();

    storeBootstrap();
    bookmarkBootstrap();
    savedChromeSessionBootstrap();
    fullTextSearchBootstrap();
    localStorageInit();

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

    await getTabSpaceData().savedTabSpaceStore.querySavedTabSpaceCount();

    renderPage({
      pageComponent: (
        <div>
          <ManagerView queryParams={queryParams as IManagerQueryParams} />
        </div>
      ),
    });
  }

  chrome.tabs.getCurrent((tab) => {
    chrome.tabs.update(tab.id, { pinned: true, autoDiscardable: false });
  });
}

logger.log('Tabverse extension id:', chrome.runtime.id);

bootstrap();
