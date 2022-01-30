import * as React from 'react';

import classes from './IndicatorLine.module.scss';

export interface IndicatorLineProps {
  children: React.ReactElement | React.ReactFragment | string;
}

export function IndicatorLine(props: IndicatorLineProps) {
  return <div className={classes.indicatorLine}>{props.children}</div>;
}
