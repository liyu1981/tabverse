import React from 'react';

import { useSidebarActions } from './SidebarContainer';
import classes from './TabSpaceLogo.module.scss';
import { merge } from 'lodash';

export interface TabSpaceLogoProps {
  collapsed?: boolean;
  /** dev page override for the universe graphic position */
  universeShapeStyles?: React.CSSProperties;
  /** dev page override for the wordmark position */
  textStyles?: React.CSSProperties;
  text?: string;
}

export const TabSpaceLogo = (props: TabSpaceLogoProps) => {
  // the rail is 72px wide: the wordmark and the universe graphic do not fit, so
  // only the square mark is shown (the decoration is the same as expanded).
  // With no chevron in the rail, this mark is also the way back out.
  const { expandSidebar } = useSidebarActions();
  if (props.collapsed) {
    return (
      <div className={classes.collapsedContainer}>
        <button
          type="button"
          className={classes.collapsedMarkButton}
          onClick={expandSidebar}
          title="Expand the sidebar"
          aria-label="Expand the sidebar"
        >
          <img className={classes.collapsedMark} src="icons/icon128.png" />
        </button>
      </div>
    );
  }
  return (
    <div
      style={{
        minHeight: '80px',
        position: 'relative',
        display: 'table',
        maxWidth: '295px',
        margin: '0 auto',
      }}
    >
      <div>
        <img
          style={merge(
            {
              position: 'absolute',
              top: '-64px',
              right: '-82px',
            },
            props.universeShapeStyles,
          )}
          src="static/tabverse_logo_universe.svg"
        />
      </div>
      <div
        style={merge(
          {
            display: 'table-cell',
            position: 'relative',
            zIndex: 10,
          },
          props.textStyles,
        )}
      >
        <h1 className={classes.logo}>{props.text ?? 'TABVERSE'}</h1>
      </div>
    </div>
  );
};
