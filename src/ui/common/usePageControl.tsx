import * as React from 'react';
import { useState } from 'react';
import { ButtonGroup, Button } from '@blueprintjs/core';

export function usePageControl<T>(
  pageItems: T[],
  pageLimit: number,
): [() => T[], () => JSX.Element | string] {
  const totalCount = pageItems.length;
  const [startPage, setStartPage] = useState(0);
  const totalPage =
    totalCount % pageLimit === 0
      ? Math.floor(totalCount / pageLimit)
      : Math.floor(totalCount / pageLimit) + 1;
  const getCurrentPageItems = () => {
    return pageItems.slice(startPage * pageLimit, (startPage + 1) * pageLimit);
  };
  const renderPageControl =
    totalPage > 1
      ? () => {
          return (
            <div>
              <ButtonGroup>
                <Button
                  minimal={true}
                  icon="chevron-left"
                  onClick={() => {
                    setStartPage((lastStart) => {
                      const newStart = lastStart - 1;
                      return newStart > 0 ? newStart : 0;
                    });
                  }}
                ></Button>
                <Button minimal={true}>{`${
                  startPage + 1
                }/${totalPage}`}</Button>
                <Button
                  minimal={true}
                  icon="chevron-right"
                  onClick={() => {
                    setStartPage((lastStart) => {
                      const newStart = lastStart + 1;
                      return newStart + 1 >= totalPage
                        ? totalPage - 1
                        : totalPage;
                    });
                  }}
                ></Button>
              </ButtonGroup>
            </div>
          );
        }
      : () => '';
  return [getCurrentPageItems, renderPageControl];
}
