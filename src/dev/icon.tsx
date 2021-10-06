import * as React from 'react';

import { Colors } from '@blueprintjs/core';
import { TabSpaceLogo } from '../ui/common/TabSpaceLogo';
import { render } from 'react-dom';

const TabSpaceIcon = () => {
  return (
    <div
      style={{
        minWidth: '1024px',
        minHeight: '1024px',
        maxWidth: '1024px',
        maxHeight: '1024px',
        border: '1px solid #ccc',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        backgroundColor: Colors.GRAY1,
      }}
    >
      <div
        style={{
          margin: '0 auto',
          display: 'flex',
          width: '100%',
          zoom: 6,
        }}
      >
        <TabSpaceLogo
          text="TV"
          universeShapeStyles={{
            top: '-14px',
            right: '98px',
          }}
          textStyles={{
            left: '14px',
            zoom: 1.6,
            top: '12px',
          }}
        />
      </div>
    </div>
  );
};

render(<TabSpaceIcon />, document.getElementById('root'));
