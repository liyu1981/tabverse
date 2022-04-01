import { Dialog } from '@blueprintjs/core';
import React from 'react';
import { TABSPACE_VERSION } from '../../global';
import { TabSpaceLogo } from '../common/TabSpaceLogo';
import classes from './AboutDialog.module.scss';

export const AboutDialog = (props) => {
  return (
    <Dialog
      className={classes.container}
      isOpen={props.isOpen}
      onClose={props.onClose}
      canOutsideClickClose={true}
      icon="help"
      title={'About Tabverse'}
    >
      <div className={classes.logoContainer}>
        <div className={classes.logoContainer2}>
          <TabSpaceLogo />
        </div>
      </div>
      <div className={classes.otherContainer}>
        <p className={classes.aboutText1}>
          Opinionated Way of Managing Tabs
          <br />
          <sub>{TABSPACE_VERSION}</sub>
        </p>
        <p className={classes.aboutText2}>Created in Sydney</p>
        <p className={classes.aboutText2}>
          <a
            className={classes.aboutTextLink}
            href="https://liyu1981.github.io/tabverse/"
          >
            Website
          </a>{' '}
          |{' '}
          <a
            className={classes.aboutTextLink}
            href="https://github.com/liyu1981/tabverse"
          >
            Github
          </a>
        </p>
      </div>
    </Dialog>
  );
};
