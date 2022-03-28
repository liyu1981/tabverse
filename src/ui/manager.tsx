import { IManagerQueryParams, ManagerView } from './manager/ManagerView';
import {
  TabSpaceOp,
  hasOwnProperty,
  isTabSpaceManagerPage,
  logger,
} from '../global';

import { CountExit } from './common/CountExit';
import React from 'react';
import { strict as assert } from 'assert';
import { find } from 'lodash';
import { bootstrap as fullTextSearchBootstrap } from '../fullTextSearch';
import { getQueryParameters } from './common/queryAndHashParameter';
import { localStorageInit } from '../store/localStorageWrapper';
import { renderPage } from './common/base';
import { bootstrap as storeBootstrap } from '../store/bootstrap';
import { bootstrap as tabSpaceRegistryServiceBootstrap } from '../data/tabSpaceRegistry';
import { tabSpaceBootstrap } from '../data/tabSpaceBootstrap';
import { loadTabSpaceByTabSpaceId } from '../data/tabSpace/util';
import { tabSpaceStoreApi } from '../data/tabSpace/store';

async function bootstrap() {
  const thisChromeTab = await chrome.tabs.getCurrent();
  const tsChromeTab = find(
    await chrome.tabs.query({ currentWindow: true }),
    (tab: chrome.tabs.Tab) => isTabSpaceManagerPage(tab),
  );
  if (tsChromeTab && tsChromeTab.id !== thisChromeTab.id) {
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
    fullTextSearchBootstrap();
    localStorageInit();

    switch (queryParams.op) {
      case TabSpaceOp.LoadSaved:
        await tabSpaceBootstrap(tsChromeTab.id, tsChromeTab.windowId);
        await loadTabSpaceByTabSpaceId(
          queryParams.stsid,
          tsChromeTab.id,
          tsChromeTab.windowId,
        );
        break;
      default:
        await tabSpaceBootstrap(tsChromeTab.id, tsChromeTab.windowId);
    }

    await tabSpaceStoreApi.reQuerySavedTabSpaceCount();

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
