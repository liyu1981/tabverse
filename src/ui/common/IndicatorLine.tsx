import React from 'react';
import classes from './IndicatorLine.module.scss';
import clsx from 'clsx';

export interface IndicatorLineProps {
  className?: string;
  children: React.ReactElement | React.ReactNode | string;
}

export function IndicatorLine(props: IndicatorLineProps) {
  return (
    <div className={clsx(classes.indicatorLine, props.className)}>
      {props.children}
    </div>
  );
}
