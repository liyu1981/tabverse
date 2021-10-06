import 'react-grid-layout/css/styles.css';

import * as React from 'react';

import { Responsive, WidthProvider } from 'react-grid-layout';

const ResponsiveReactGridLayout = WidthProvider(Responsive);

export const defaultGridLayoutProps = {
  rowHeight: 500,
  cols: { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 },
};

export interface IGridLayoutProps {
  children: React.ReactElement[];
}

export const GridLayout = (props: IGridLayoutProps) => {
  return (
    <>
      <ResponsiveReactGridLayout
        {...props}
        measureBeforeMount={false}
        useCSSTransforms={true}
        compactType={'vertical'}
        preventCollision={true}
      >
        {props.children}
      </ResponsiveReactGridLayout>
    </>
  );
};
