import React from 'react';
import classes from './TabSpaceLogo.module.scss';
import { merge } from 'lodash';

export const TabSpaceLogo = (props) => {
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
