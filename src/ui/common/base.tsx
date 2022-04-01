import React from 'react';
import { ReactElement } from 'react';
import { defaults } from 'lodash';
import { render } from 'react-dom';

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
  if (p.pageComponent) {
    render(<>{p.pageComponent}</>, document.getElementById(p.containerDivId));
  } else {
    console.error('PageComponent not provided! Skip render!');
  }
}
