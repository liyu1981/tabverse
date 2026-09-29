import { fromNow } from '../../../time';
import { Tooltip } from '@blueprintjs/core';
import React from 'react';
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
          {savedTime > 0 ? `${key} saved ${fromNow(savedTime)}` : ''}
        </div>
      ))}
    </div>
  );
  const savedFromNow = (
    <Tooltip content={allSavedTimesContent}>
      {`Saved ${fromNow(lastSavedTime)}`}
    </Tooltip>
  );
  const allSavingContent = (
    <div>
      {whoIsInSaving.map((who) => (
        <div key={who}>{`${who} is saving.`}</div>
      ))}
    </div>
  );
  const saving = <Tooltip content={allSavingContent}>...saving</Tooltip>;
  return <span>{anyInSaving ? saving : savedFromNow}</span>;
}
