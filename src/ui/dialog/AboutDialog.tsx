import * as React from 'react';

import { Colors, Dialog } from '@blueprintjs/core';

import { TabSpaceLogo } from '../common/TabSpaceLogo';

function createdStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      minHeight: '500px',
      paddingBottom: 0,
    },
    logoContainer: {
      backgroundColor: Colors.GRAY1,
      width: '100%',
      display: 'table',
      minHeight: '250px',
    },
    logoContainer2: {
      width: '100%',
      display: 'table-cell',
      verticalAlign: 'middle',
    },
    otherContainer: {
      backgroundColor: Colors.GRAY1,
      width: '100%',
      height: '210px',
      display: 'flex',
      borderRadius: '0 0 4px 4px',
      flexDirection: 'column',
      alignItems: 'center',
    },
    aboutText1: {
      display: 'block',
      fontSize: '1.6em',
      color: 'white',
      textShadow: '0 1px 0 black',
      marginBottom: '80px',
    },
    aboutText2: {
      display: 'block',
      fontSize: '1.2em',
      color: 'white',
      textShadow: '0 1px 0 black',
    },
  };
}

export const AboutDialog = (props) => {
  const styles = createdStyles();
  return (
    <Dialog
      style={styles.container}
      isOpen={props.isOpen}
      onClose={props.onClose}
      canOutsideClickClose={true}
      icon="help"
      title={'About Tabverse'}
    >
      <div style={styles.logoContainer}>
        <div style={styles.logoContainer2}>
          <TabSpaceLogo />
        </div>
      </div>
      <div style={styles.otherContainer}>
        <p style={styles.aboutText1}>Opinionated Way of Managing Tabs</p>
        <p style={styles.aboutText2}>Created in Sydney</p>
      </div>
    </Dialog>
  );
};
