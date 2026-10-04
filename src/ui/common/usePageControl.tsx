import { Button, ButtonGroup } from '@blueprintjs/core';
import React, { useState } from 'react';

/**
 * A page index that is never past the last page and never before the first.
 *
 * Named, exported, and the only place the arithmetic happens, because it got
 * this wrong once. The right arrow returned the *last* page where it meant to
 * return the *next* one, so a person on page 1 of 3 clicked "next" and landed on
 * "4/3" - and only the left arrow could walk them back.
 */
export function clampPage(page: number, totalPage: number): number {
  if (totalPage <= 1) {
    return 0;
  }
  return Math.min(Math.max(page, 0), totalPage - 1);
}

export function usePageControl<T>(
  pageItems: T[],
  pageLimit: number,
): [() => T[], () => React.JSX.Element | string] {
  const totalCount = pageItems.length;
  const [startPage, setStartPage] = useState(0);
  const totalPage =
    totalCount % pageLimit === 0
      ? Math.floor(totalCount / pageLimit)
      : Math.floor(totalCount / pageLimit) + 1;
  // The page actually on screen. Clamped as well as the arrows are, because the
  // list can shrink under the person: the extension's History is live, and
  // deleting or clearing entries while reading page three would otherwise leave
  // an empty page labelled "3/2".
  const page = clampPage(startPage, totalPage);
  const getCurrentPageItems = () => {
    return pageItems.slice(page * pageLimit, (page + 1) * pageLimit);
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
                  title="Previous page"
                  onClick={() => {
                    setStartPage((lastStart) =>
                      clampPage(lastStart - 1, totalPage),
                    );
                  }}
                ></Button>
                <Button minimal={true} disabled={true}>
                  {`${page + 1}/${totalPage}`}
                </Button>
                <Button
                  minimal={true}
                  icon="chevron-right"
                  title="Next page"
                  onClick={() => {
                    setStartPage((lastStart) =>
                      clampPage(lastStart + 1, totalPage),
                    );
                  }}
                ></Button>
              </ButtonGroup>
            </div>
          );
        }
      : () => '';
  return [getCurrentPageItems, renderPageControl];
}
