import {
  Callout,
  Popover,
  PopoverInteractionKind,
  Tag,
} from '@blueprintjs/core';
import React from 'react';

import {
  Capability,
  detectChromeMajorVersion,
  missingCapabilities,
} from '../../../capabilities';
import classes from './CapabilityWarning.module.scss';

const CHROME_DOWNLOAD_URL = 'https://www.google.com/chrome/';

function CapabilityRow(props: { capability: Capability }) {
  const { capability } = props;
  return (
    <div className={classes.row}>
      <div className={classes.rowTitle}>
        <b>{capability.title}</b>
        <Tag minimal={true} className={classes.versionTag}>
          {`needs Chrome ${capability.requiresChrome}+`}
        </Tag>
      </div>
      <div className={classes.rowLost}>{capability.lost}</div>
    </div>
  );
}

/**
 * One line above the tab list when the browser is missing an optional feature,
 * with a popover spelling out what is missing. Deliberately not dismissible: it
 * describes the environment, not a task the user has to do - and it must never
 * get in the way of the tab list itself.
 */
export function CapabilityWarning() {
  const missing = missingCapabilities();
  if (missing.length === 0) {
    return null;
  }
  const chromeVersion = detectChromeMajorVersion();

  const detail = (
    <div className={classes.detail}>
      {missing.map((capability) => (
        <CapabilityRow key={capability.id} capability={capability} />
      ))}
      <div className={classes.footer}>
        <a href={CHROME_DOWNLOAD_URL} target="_blank" rel="noreferrer">
          Update Chrome
        </a>
        . Tab capture, tabverses, notes and sync keep working either way.
      </div>
    </div>
  );

  return (
    <div className={classes.container}>
      <Popover
        content={detail}
        interactionKind={PopoverInteractionKind.CLICK}
        placement="bottom-start"
        minimal={true}
        // the default target is a span (inline), which would let the callout
        // shrink to the width of its text instead of the column's
        targetTagName="div"
      >
        <Callout
          intent="warning"
          icon="warning-sign"
          className={classes.callout}
        >
          {`${missing.length} tab feature${
            missing.length > 1 ? 's' : ''
          } unavailable in this Chrome`}
          {chromeVersion > 0 ? ` (running ${chromeVersion})` : ''} — click for
          details
        </Callout>
      </Popover>
    </div>
  );
}
