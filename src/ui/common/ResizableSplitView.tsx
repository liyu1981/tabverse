import * as React from 'react';

import { merge } from 'lodash';

export interface IResizableSplitViewProps {
  firstView: React.ReactElement;
  firstViewStyles?: React.CSSProperties;
  secondView: React.ReactElement;
  secondViewStyles?: React.CSSProperties;
}

function createStyles(): {
  [k: string]: React.CSSProperties;
} {
  return {
    container: {
      display: 'flex',
      height: '100%',
      width: '100%',
    },
    containerLeft: {
      width: '50%',
      display: 'flex',
    },
    resizer: {
      backgroundColor: '#cbd5e0',
      cursor: 'ew-resize',
      height: '100%',
      width: '20px',
    },
    containerRight: {
      flex: 2,
      display: 'flex',
    },
    containerRightFixed: {
      position: 'sticky',
      top: '0px',
      height: '100vh',
    },
  };
}

export const ResizableSplitView = (props) => {
  const styles = createStyles();
  return (
    <div style={styles.container}>
      <div style={merge(styles.containerLeft, props.firstViewStyles)}>
        {props.firstView}
      </div>
      <div style={styles.resizer}></div>
      <div
        style={merge(
          styles.containerRight,
          styles.containerRightFixed,
          props.secondViewStyles,
        )}
      >
        {props.secondView}
      </div>
    </div>
  );
};
