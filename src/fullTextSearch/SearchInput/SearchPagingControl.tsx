import { Button, ButtonGroup } from '@blueprintjs/core';

import { IFullTextSearchCursor } from '../searcher';
import React from 'react';

export interface SearchPagingControlProps {
  cursors: IFullTextSearchCursor[];
  currentCursorIndex: number | null;
  nextCursor: IFullTextSearchCursor | null;
  onClickCursor: (cursorIndex: number) => void;
  onClickMore: () => void;
}

export function SearchPagingControl(props: SearchPagingControlProps) {
  return (
    <ButtonGroup>
      {props.cursors.map((cursor, index) => {
        return (
          <Button
            key={`cursor-${index}`}
            minimal={true}
            onClick={
              index === props.currentCursorIndex
                ? null
                : () => props.onClickCursor(index)
            }
          >
            {index === props.currentCursorIndex ? (
              <b>{`${index + 1}`}</b>
            ) : (
              `${index + 1}`
            )}
          </Button>
        );
      })}
      {props.nextCursor.hasMorePage ? (
        <Button minimal={true} onClick={() => props.onClickMore()}>
          more
        </Button>
      ) : null}
    </ButtonGroup>
  );
}
