// Vendor styles first: the popup's own stylesheet and css modules have to come
// after them, in the emitted order.
import 'normalize.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import '@blueprintjs/icons/lib/css/blueprint-icons.css';
// the same control styles the manager page uses, then the popup's own
import './theme.scss';
import './popup/popup.scss';

import React from 'react';

import { PopupView } from './popup/PopupView';
import { renderPage } from './common/base';
import { setDebugLogLevel, TabSpaceLogLevel } from '../debug';

setDebugLogLevel(TabSpaceLogLevel.LOG);
console.info('Tabverse popup');

renderPage({ pageComponent: <PopupView /> });
