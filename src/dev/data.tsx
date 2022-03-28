import React from 'react';
import ReactJson from 'react-json-view';
import { render } from 'react-dom';
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
            <ReactJson src={tabSpaceJSON} />
          </td>
        </tr>
      </table>
    </div>
  );
}

async function start() {
  const tab = await chrome.tabs.getCurrent();
  const window = await chrome.windows.getCurrent();
  tabSpaceBootstrap(tab.id, window.id);
  render(<DataView />, document.getElementById('root'));
}

start();
