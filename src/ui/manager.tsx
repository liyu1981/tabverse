// Vendor styles first: everything below (manager.scss, css modules) has to
// come after them in the emitted stylesheet. Vite bundles these instead of
// the old copycss.sh -> dist/static + <link> dance.
import 'normalize.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
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
import { getNewId } from '../data/common';
import { pinTabverseTabFirst } from '../data/tabSpace/chromeUtil';
import { getQueryParameters } from './common/queryAndHashParameter';
import { loadTabSpaceByTabSpaceId } from '../data/tabSpace/util';
import { localStorageInit } from '../storage/localStorageWrapper';
import { renderPage } from './common/base';
import { tabSpaceBootstrap } from '../data/tabSpaceBootstrap';
import { tabSpaceStoreApi } from '../data/tabSpace/store';
import { startChangeFeed } from '../data/repo/changeFeed';

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

    fullTextSearchBootstrap();
    localStorageInit();
    // queue local database writes for the server sync engine; awaited so the
    // tabverse bootstrap below is not written before the hooks are in place
    await startChangeFeed();

    // A tab opened by an older build has no tvid; the in-memory tabspace is
    // rebuilt on every load anyway, so minting one here cannot orphan anything
    // that was not already local-only.
    const tabSpaceId = queryParams.tvid || getNewId();
    await tabSpaceBootstrap(tsChromeTab.id, tsChromeTab.windowId, tabSpaceId);
    if (queryParams.op === TabSpaceOp.LoadSaved) {
      await loadTabSpaceByTabSpaceId(
        tabSpaceId,
        tsChromeTab.id,
        tsChromeTab.windowId,
      );
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

  const thisTab = await chrome.tabs.getCurrent();
  if (thisTab?.id !== undefined) {
    await pinTabverseTabFirst(thisTab.id);
  }
}

logger.log('Tabverse extension id:', chrome.runtime.id);

bootstrap();
