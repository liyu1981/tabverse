import * as React from 'react';

import { Tab as BPTab, Tabs as BPTabs, Icon } from '@blueprintjs/core';

import { BookmarkView } from '../../bookmark/BookmarkView';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { NotebookView } from '../../notebook/NotebookView';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TodoView } from '../../todo/TodoView';
import { loadByTabSpaceId as bookmarkLoadByTabSpaceId } from '../../../data/bookmark/bootstrap';
import { getAllBookmarkData } from '../../../data/bookmark/bootstrap';
import { getAllNoteData } from '../../../data/note/bootstrap';
import { getAllTodoData } from '../../../data/todo/bootstrap';
import { getLoadingComponent } from '../../common/LoadingComponent';
import { loadByTabSpaceId as noteLoadByTabSpaceId } from '../../../data/note/bootstrap';
import { loadByTabSpaceId as todoLoadByTabSpaceId } from '../../../data/todo/bootstrap';
import { useMemo } from 'react';
import classes from './TabSpaceRightSideView.module.scss';

export interface ITabSpaceRightSideViewProps {
  tabSpace: TabSpace;
}

export const TabSpaceRightSideView = ({
  tabSpace,
}: ITabSpaceRightSideViewProps) => {
  const [TodoWithLoading, BookmarkWithLoading, NotebookWithLoading] =
    useMemo(() => {
      const todoLoader = async () => {
        await todoLoadByTabSpaceId(tabSpace.id);
        return getAllTodoData();
      };
      const TodoWithLoading = getLoadingComponent(
        TodoView,
        todoLoader,
        'allTodoData',
      );

      const bookmarkLoader = async () => {
        await bookmarkLoadByTabSpaceId(tabSpace.id);
        return getAllBookmarkData();
      };
      const BookmarkWithLoading = getLoadingComponent(
        BookmarkView,
        bookmarkLoader,
        'allBookmarkData',
      );

      const noteLoader = async () => {
        await noteLoadByTabSpaceId(tabSpace.id);
        return getAllNoteData();
      };
      const NotebookWithLoading = getLoadingComponent(
        NotebookView,
        noteLoader,
        'allNoteData',
      );

      return [TodoWithLoading, BookmarkWithLoading, NotebookWithLoading];
    }, []);

  return (
    <ErrorBoundary>
      <div className={classes.container}>
        <div className={classes.tabsContainer}>
          <BPTabs animate={true} renderActiveTabPanelOnly={false}>
            <BPTab
              id="todo"
              title={
                <span>
                  <Icon icon="confirm" /> Todo
                </span>
              }
              panel={<TodoWithLoading />}
            />
          </BPTabs>
        </div>
        <div className={classes.tabsContainer}>
          <BPTabs animate={true} renderActiveTabPanelOnly={false}>
            <BPTab
              id="note"
              title={
                <span>
                  <Icon icon="clipboard" /> Note
                </span>
              }
              panel={<NotebookWithLoading />}
            />
            <BPTab
              id="bookmark"
              title={
                <span>
                  <Icon icon="book" /> Bookmark
                </span>
              }
              panel={<BookmarkWithLoading />}
            />
          </BPTabs>
        </div>
      </div>
    </ErrorBoundary>
  );
};
