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
              Pin Tabverse from the Chrome toolbar (puzzle icon) for quick
              access.
            </li>
            <li>Open the manager and create your first tabverse.</li>
            <li>Group tabs into tabverses; save and reopen them anytime.</li>
            <li>Pair with a server only if you want sync across devices.</li>
          </ol>
          <div className={classes.demoPlaceholder}>
            Demo video / GIF coming soon
          </div>
        </main>
      </div>
    </div>
  );
};
