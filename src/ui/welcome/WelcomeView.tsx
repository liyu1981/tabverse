import React from 'react';

import { TABSPACE_VERSION } from '../../global';
import { t } from '../../i18n';
import { TabSpaceLogo } from '../common/TabSpaceLogo';
import classes from './WelcomeView.module.scss';

export const WelcomeView = () => {
  return (
    <div className={classes.shell}>
      <div className={classes.card}>
        <header className={classes.header}>
          <div className={classes.logoContainer}>
            <TabSpaceLogo />
          </div>
          <div className={classes.taglineContainer}>
            <p className={classes.tagline}>
              {t('aboutTagline')}
              <br />
              <sub>{TABSPACE_VERSION}</sub>
            </p>
          </div>
        </header>
        <main className={classes.body}>
          <h2 className={classes.heading}>Get started</h2>
          <ol className={classes.steps}>
            <li>
              <span className={classes.stepIcon} aria-hidden="true">
                🧩
              </span>
              Pin Tabverse from the Chrome toolbar, then click the
              <img
                className={classes.stepLogo}
                src="/icons/icon48.png"
                alt=""
                aria-hidden="true"
              />
              Tabverse icon to create your first tabverse.
            </li>
            <li>
              <span className={classes.stepIcon} aria-hidden="true">
                🗂️
              </span>
              With a tabverse open, work as usual — open and close tabs, take
              notes, todos and bookmarks. Everything is saved automatically, and
              you can reopen it later from the Tabverse popup.
            </li>
          </ol>
          <div className={classes.demoPlaceholder}>
            <img
              className={classes.demoMedia}
              src="/static/tabverse-welcome-intro.gif"
              alt="Tabverse demo"
            />
          </div>
        </main>
      </div>
    </div>
  );
};
