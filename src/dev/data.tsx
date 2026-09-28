import React from 'react';
import { createRoot } from 'react-dom/client';
import { getNewId } from '../data/common';
import { tabSpaceBootstrap } from '../data/tabSpaceBootstrap';
import { useStore } from 'effector-react';
import { $tabSpace } from '../data/tabSpace/store';

function DataView() {
  const tabSpace = useStore($tabSpace);
  const tabSpaceJSON = {
    ...tabSpace,
    tabs: null,
    tabIds: tabSpace.tabs.map((tab) => tab.id).toArray(),
  };
  return (
    <div style={{ fontSize: '18px' }}>
      <table style={{ width: '100%', height: '100%' }}>
        <tr>
          <td width="33%">tabSpace</td>
        </tr>
        <tr style={{ verticalAlign: 'top' }}>
          <td width="33%">
            <pre style={{ maxHeight: 700, overflow: 'auto' }}>
              {JSON.stringify(tabSpaceJSON, null, 2)}
            </pre>
          </td>
        </tr>
      </table>
    </div>
  );
}

async function start() {
  const tab = await chrome.tabs.getCurrent();
  const window = await chrome.windows.getCurrent();
  tabSpaceBootstrap(tab.id, window.id, getNewId());
  createRoot(document.getElementById('root')!).render(<DataView />);
}

start();
