import { TabSpaceOp, isTabSpaceManagerPage } from '../global';

import { find } from 'lodash';

// chrome.tabs.create({ url: 'devdata.html' });

function openManager() {
  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const t = find(tabs, (tab) => isTabSpaceManagerPage(tab));
    if (t) {
      chrome.tabs.update(t.id, { active: true });
      window.close();
    } else {
      chrome.tabs.create({ url: `manager.html?op=${TabSpaceOp.New}` });
    }
  });
}

console.info('Tabverse!');
openManager();
