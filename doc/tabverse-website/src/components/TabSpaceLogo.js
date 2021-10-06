import './TabSpaceLogo.module.css';

import * as React from 'react';

import styles from './TabSpaceLogo.module.css';

export const TabSpaceLogo = () => {
  return (
    <div
      style={{
        minHeight: '80px',
        position: 'relative',
        display: 'table',
        maxWidth: '395px',
        margin: '60px auto',
      }}
    >
      <div>
        <img
          style={{
            position: 'absolute',
            top: '-86px',
            right: '-74px',
          }}
          src="img/tabverse_logo_universe.svg"
        />
      </div>
      <div
        style={{
          display: 'table-cell',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <h1 className={styles.tabSpaceLogo} style={{ minWidth: '202px' }}>
          TABVERSE
        </h1>
      </div>
    </div>
  );
};
