import React from 'react';
import { ReactElement } from 'react';
import { defaults } from 'lodash';
import { createRoot } from 'react-dom/client';

export interface IBasePageOptions {
  pageComponent?: ReactElement | null;
  containerDivId?: string;
}

export const defaultPageOptions = {
  containerDivId: 'root',
  pageComponent: null,
};

export function renderPage(props: IBasePageOptions = defaultPageOptions): void {
  const p = defaults(props, defaultPageOptions);
  const container = document.getElementById(p.containerDivId);
  if (p.pageComponent && container) {
    createRoot(container).render(<>{p.pageComponent}</>);
  } else {
    console.error('PageComponent not provided! Skip render!');
  }
}
