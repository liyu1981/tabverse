import Moment from 'moment';
import React from 'react';
import { Tooltip2 } from '@blueprintjs/popover2';
import { useStore } from 'effector-react';
import { $storageOverview } from '../../../storage/StorageOverview';

export function SaveIndicator() {
  const storageOverview = useStore($storageOverview);
  const [anyInSaving, whoIsInSaving] = storageOverview.anyStorageInSaving();
  const lastSavedTime = storageOverview.getLastSavedStorage().lastSavedTime;
  const allSavedTimes = storageOverview.getAllLastSavedTime();
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
