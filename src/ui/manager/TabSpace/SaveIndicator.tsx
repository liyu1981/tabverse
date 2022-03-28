import Moment from 'moment';
import React from 'react';
import { Tooltip2 } from '@blueprintjs/popover2';
import { getStorageManager } from '../../../store/bootstrap';

export function SaveIndicator() {
  // here we do observe whatever given to us in props but also ignore of that
  // because just want it to notify us for an update
  const storageManager = getStorageManager();
  const [anyInSaving, whoIsInSaving] = storageManager.anyStorageInSaving();
  const lastSavedTime = storageManager.getLastSavedStorage().lastSavedTime;
  const allSavedTimes = storageManager.getAllLastSavedTime();
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
}
