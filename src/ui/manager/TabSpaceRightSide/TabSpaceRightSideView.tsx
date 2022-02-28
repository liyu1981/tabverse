import * as React from 'react';

import { Tab as BPTab, Tabs as BPTabs, Icon, Button } from '@blueprintjs/core';

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
import { useMemo, useState } from 'react';
import classes from './TabSpaceRightSideView.module.scss';

enum RightSideModule {
  TODO = 'todo',
  NOTE = 'note',
  BOOKMARK = 'bookmark',
}

export interface ITabSpaceRightSideViewProps {
  tabSpace: TabSpace;
}

export const TabSpaceRightSideView = ({
  tabSpace,
}: ITabSpaceRightSideViewProps) => {
  const [pinned, setPinned] = useState<string>(RightSideModule.TODO);

  const rightSideModules = useMemo(() => {
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

    return {
      [RightSideModule.TODO]: TodoWithLoading,
      [RightSideModule.NOTE]: NotebookWithLoading,
      [RightSideModule.BOOKMARK]: BookmarkWithLoading,
    };
  }, []);

  const rightSideModuleTitles = useMemo(() => {
    return {
      [RightSideModule.TODO]: (
        <span>
          <Icon icon="confirm" /> Todo
        </span>
      ),
      [RightSideModule.NOTE]: (
        <span>
          <Icon icon="clipboard" /> Note
        </span>
      ),
      [RightSideModule.BOOKMARK]: (
        <span>
          <Icon icon="book" /> Bookmark
        </span>
      ),
    };
  }, []);

  const [currentUnpinned, setCurrentUnpinned] = useState<string>(() => {
    const restUnpinned = Object.keys(rightSideModules).filter(
      (k) => k !== pinned,
    );
    return restUnpinned[0];
  });

  const unpinCurrentTool = () => {
    setPinned(null);
    setCurrentUnpinned(pinned);
  };

  const pinCurrentTool = () => {
    setPinned(currentUnpinned);
    const restUnpinned = Object.keys(rightSideModules).filter(
      (k) => k !== currentUnpinned,
    );
    setCurrentUnpinned(restUnpinned[0]);
  };

  const unpinned = Object.keys(rightSideModules).filter((k) => k !== pinned);

  return (
    <ErrorBoundary>
      <div className={classes.container}>
        {pinned !== null ? (
          <div className={classes.tabsContainer}>
            <Button
              minimal={true}
              className={classes.floatRightButton}
              onClick={unpinCurrentTool}
              title="Unpin current tool"
            >
              <Icon icon="unlock" />
            </Button>
            <BPTabs
              animate={true}
              renderActiveTabPanelOnly={false}
              selectedTabId={pinned}
              className={classes.bpTabs}
            >
              <BPTab
                id={pinned}
                title={rightSideModuleTitles[pinned]}
                panel={React.createElement(rightSideModules[pinned])}
              />
            </BPTabs>
          </div>
        ) : (
          ''
        )}
        <div className={classes.tabsContainer}>
          <Button
            minimal={true}
            className={classes.floatRightButton}
            title="Pin current tool"
            onClick={pinCurrentTool}
          >
            <Icon icon="lock" />
          </Button>
          <BPTabs
            animate={true}
            renderActiveTabPanelOnly={false}
            onChange={(newTabId: string) => setCurrentUnpinned(newTabId)}
            selectedTabId={currentUnpinned}
            className={classes.bpTabs}
          >
            {unpinned.map((key) => {
              const componentClass = rightSideModules[key];
              return (
                <BPTab
                  key={key}
                  id={key}
                  title={rightSideModuleTitles[key]}
                  panel={React.createElement(componentClass)}
                />
              );
            })}
          </BPTabs>
        </div>
      </div>
    </ErrorBoundary>
  );
};
