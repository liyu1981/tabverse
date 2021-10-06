import * as Moment from 'moment';
import * as React from 'react';

import { Tooltip2 } from '@blueprintjs/popover2';
import { getSavedStoreManager } from '../../store/bootstrap';
import { observer } from 'mobx-react-lite';

export const SaveIndicator = observer((props) => {
  // here we do observe whatever given to us in props but also ignore of that
  // because just want it to notify us for an update
  const savedStoreManager = getSavedStoreManager();
  const [anyInSaving, whoIsInSaving] = savedStoreManager.anyStoreInSaving();
  const lastSavedTime = savedStoreManager.getLastSavedStore().lastSavedTime;
  const allSavedTimes = savedStoreManager.getAllLastSavedTime();
  const allSavedTimesContent = (
    <div>
      {allSavedTimes.map(([key, savedTime]) => (
        <div key={key}>
          {savedTime > 0 ? `${key} saved ${Moment(savedTime).fromNow()}` : ''}
        </div>
      ))}
    </div>
  );
  const savedFromNow = (
    <Tooltip2 content={allSavedTimesContent}>
      {`Saved ${Moment(lastSavedTime).fromNow()}`}
    </Tooltip2>
  );
  const allSavingContent = (
    <div>
      {whoIsInSaving.map((who) => (
        <div key={who}>{`${who} is saving.`}</div>
      ))}
    </div>
  );
  const saving = <Tooltip2 content={allSavingContent}>...saving</Tooltip2>;
  return <span>{anyInSaving ? saving : savedFromNow}</span>;
});
