import { Button, ButtonGroup } from '@blueprintjs/core';

import React from 'react';

export interface PagingControlProps {
  current: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onLast: () => void;
  onFirst: () => void;
}

export function PagingControl(props: PagingControlProps) {
  return (
    <ButtonGroup>
      <Button
        minimal={true}
        icon="double-chevron-left"
        onClick={props.onFirst}
      ></Button>
      <Button
        minimal={true}
        icon="chevron-left"
        onClick={props.onPrev}
      ></Button>
      <Button minimal={true}>{`${props.current}/${props.total}`}</Button>
      <Button
        minimal={true}
        icon="chevron-right"
        onClick={props.onNext}
      ></Button>
      <Button
        minimal={true}
        icon="double-chevron-right"
        onClick={props.onLast}
      ></Button>
    </ButtonGroup>
  );
}
