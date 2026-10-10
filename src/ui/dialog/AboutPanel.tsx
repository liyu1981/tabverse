// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React from 'react';

import { TABSPACE_VERSION } from '../../global';
import { TabSpaceLogo } from '../common/TabSpaceLogo';
import classes from './AboutPanel.module.scss';

/**
 * The About panel: the brand surface, as a section of the settings dialog.
 *
 * It used to be its own `Dialog` (and before that, the panel *was* the whole
 * dialog surface - a magic `min-height` a couple of pixels taller than its
 * content, whose leftover sliver was the white strip under the logo). As a
 * panel it keeps the same three blocks: the logo, the version, the links.
 */
export function AboutPanel() {
  return (
    <div className={classes.panel}>
      <div className={classes.logoContainer}>
        <TabSpaceLogo />
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
    </div>
  );
}
