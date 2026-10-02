// The console's entry point (adr/0018).
//
// Vendor styles first, then the product's own layer over them: Blueprint sets
// `body { font-family; color; line-height }` globally, so the order below is the
// order the console's typography is decided in - normalize, then Blueprint, then
// tokens and theme.

import 'normalize.css';
import '@blueprintjs/core/lib/css/blueprint.css';
import './tokens.scss';
import './theme.scss';

import { createRoot } from 'react-dom/client';
import React from 'react';

import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('the console shell has no #root to mount into');
}

// No StrictMode, like the extension's pages (src/ui/common/base.tsx): its double
// invocation would boot the console twice in development, which means asking the
// server who we are twice for no gain.
createRoot(container).render(<App />);
