import * as React from 'react';

import { bootstrap, getTabSpaceData } from '../data/tabSpace/bootstrap';

import ReactJson from 'react-json-view';
import { observer } from 'mobx-react-lite';
import { render } from 'react-dom';

const DataView = observer(
  ({
    tabSpace,
    tabSpaceRegistry,
  }: {
    tabSpace: any;
    tabSpaceRegistry: any;
  }) => {
    return (
      <div style={{ fontSize: '18px' }}>
        <table style={{ width: '100%', height: '100%' }}>
          <tr>
            <td width="33%">tabSpace</td>
            <td width="33%">tabSpaceRegistry</td>
          </tr>
          <tr style={{ verticalAlign: 'top' }}>
            <td width="33%">
              <ReactJson src={tabSpace.toJSON()} />
            </td>
            <td width="33%">
              <ReactJson src={tabSpaceRegistry.toJSON()} />
            </td>
          </tr>
        </table>
      </div>
    );
  },
);

async function start() {
  const tab = await chrome.tabs.getCurrent();
  const window = await chrome.windows.getCurrent();
  await bootstrap(tab.id, window.id);
  const { tabSpace, tabSpaceRegistry } = getTabSpaceData();

  render(
    <DataView tabSpace={tabSpace} tabSpaceRegistry={tabSpaceRegistry} />,
    document.getElementById('root'),
  );
}

start();
