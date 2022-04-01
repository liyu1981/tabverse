import { Dialog } from '@blueprintjs/core';
import React from 'react';

function createdStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      minWidth: '1280px',
      minHeight: '800px',
    },
  };
}

export const SettingDialog = (props) => {
  const styles = createdStyles();
  return (
    <Dialog
      style={styles.container}
      isOpen={props.isOpen}
      onClose={props.onClose}
      canOutsideClickClose={true}
      icon="cog"
      title={'Tabverse Settings'}
    >
      <div>Hello, settings!</div>
    </Dialog>
  );
};
