import { Callout, Icon, Intent, Tag } from '@blueprintjs/core';
import React, { useRef, useState } from 'react';

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
          {`Chrome ${capability.requiresChrome}+`}
        </Tag>
      </div>
      <div className={classes.rowLost}>{capability.lost}</div>
    </div>
  );
}

/**
 * The one line above the tab list when this browser is missing an optional
 * feature, which expands in place to say what is missing.
 *
 * It used to spell the details out in a popover, but a floating panel over
 * the tab list is the worst place for it: it covers the tabs it is talking
 * about, and it reads as unrelated to the bar that opened it. Expanding the
 * bar instead keeps the explanation attached to the warning and pushes the
 * list down, which is harmless. Losing focus collapses it again, so the
 * banner never grows into something permanent - it describes the environment,
 * not a task, and it must not get in the way of the tabs.
 */
export function CapabilityWarning() {
  const missing = missingCapabilities();
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const toggle = () => setExpanded((was) => !was);

  // Focus leaving the whole notice collapses it; focus moving *inside* it (to
  // the Update Chrome link) must not, or the link would vanish mid-click.
  const collapseIfFocusLeft = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !rootRef.current?.contains(next)) {
      setExpanded(false);
    }
  };

  // a real button, so Enter and Space come for free; only Escape is ours
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setExpanded(false);
    }
  };

  if (missing.length === 0) {
    return null;
  }
  const chromeVersion = detectChromeMajorVersion();

  return (
    <div className={classes.container} ref={rootRef}>
      <Callout
        intent={Intent.WARNING}
        icon="warning-sign"
        className={classes.callout}
      >
        <button
          type="button"
          className={classes.header}
          aria-expanded={expanded}
          title={expanded ? 'Hide the details' : 'Show what is missing'}
          onClick={toggle}
          onKeyDown={onKeyDown}
          onBlur={collapseIfFocusLeft}
        >
          <span className={classes.summary}>
            {`${missing.length} tab feature${missing.length > 1 ? 's' : ''} ${
              missing.length > 1 ? 'need' : 'needs'
            } a newer Chrome`}
            {chromeVersion > 0 ? ` (you have ${chromeVersion})` : ''}
          </span>
          <Icon
            className={classes.chevron}
            icon={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
          />
        </button>
        {expanded ? (
          <div className={classes.detail}>
            {missing.map((capability) => (
              <CapabilityRow key={capability.id} capability={capability} />
            ))}
            <div className={classes.footer}>
              <a href={CHROME_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                Update Chrome
              </a>
              . Everything else keeps working.
            </div>
          </div>
        ) : null}
      </Callout>
    </div>
  );
}
