import React from 'react';
import { Spinner } from '@blueprintjs/core';
import classes from './LoadingSpinner.module.scss';
import clsx from 'clsx';

export type LoadingSpinnerProps = {
  className?: string;
};

export function LoadingSpinner(props: LoadingSpinnerProps) {
  return (
    <div className={clsx(classes.container, props.className)}>
      <Spinner size={75} />
    </div>
  );
}
