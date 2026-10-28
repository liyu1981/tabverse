// Vendor styles first: the welcome page shares the control styles with the
// manager and popup pages, so a page rule can win.
import 'normalize.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
import './theme.scss';
import './welcome/welcome.scss';

import React from 'react';

import { WelcomeView } from './welcome/WelcomeView';
import { renderPage } from './common/base';
import { setDebugLogLevel, TabSpaceLogLevel } from '../debug';

setDebugLogLevel(TabSpaceLogLevel.LOG);
console.info('Tabverse welcome');

renderPage({ pageComponent: <WelcomeView /> });
