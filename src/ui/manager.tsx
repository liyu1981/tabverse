// Vendor styles first: everything below (manager.scss, css modules) has to
// come after them in the emitted stylesheet. Vite bundles these instead of
// the old copycss.sh -> dist/static + <link> dance.
import 'normalize.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import 'simplebar-react/dist/simplebar.min.css';

import { IManagerQueryParams, ManagerView } from './manager/ManagerView';
import {
  TabSpaceOp,
  assert,
  hasOwnProperty,
  isTabSpaceManagerPage,
  logger,
} from '../global';

import { CountExit } from './common/CountExit';
import React from 'react';
import { find } from 'lodash';
import { bootstrap as fullTextSearchBootstrap } from '../fullTextSearch';
import { getQueryParameters } from './common/queryAndHashParameter';
import { loadTabSpaceByTabSpaceId } from '../data/tabSpace/util';
import { localStorageInit } from '../storage/localStorageWrapper';
import { renderPage } from './common/base';
import { tabSpaceBootstrap } from '../data/tabSpaceBootstrap';
import { bootstrap as tabSpaceRegistryServiceBootstrap } from '../data/tabSpaceRegistry';
import { tabSpaceStoreApi } from '../data/tabSpace/store';
import { startChangeFeed } from '../data/repo/changeFeed';
import { startServerSyncConfiguredWatch } from '../data/repo/syncStatus';

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

    // keeps the UI honest about which features need a paired server
    // (e.g. the cross-window tabverse list in the sidebar)
    startServerSyncConfiguredWatch();

    fullTextSearchBootstrap();
    localStorageInit();
    // queue local database writes for the server sync engine
    startChangeFeed();

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
