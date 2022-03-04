import { Tab as BPTab, Tabs as BPTabs, Button, Icon } from '@blueprintjs/core';
import React, { useMemo, useState } from 'react';

import { BookmarkView } from '../../bookmark/BookmarkView';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { NotebookView } from '../../notebook/NotebookView';
import { TabSpace } from '../../../data/tabSpace/TabSpace';
import { TodoView } from '../../todo/TodoView';
import { loadByTabSpaceId as bookmarkLoadByTabSpaceId } from '../../../data/bookmark/bootstrap';
import { startMonitorLocalStorageChanges as bookmarkStartMonitorLocalStorageChanges } from '../../../data/bookmark/SavedBookmarkStore';
import classes from './TabSpaceRightSideView.module.scss';
import { getAllBookmarkData } from '../../../data/bookmark/bootstrap';
import { getAllNoteData } from '../../../data/note/bootstrap';
import { getAllTodoData } from '../../../data/todo/bootstrap';
import { getLoadingComponent } from '../../common/LoadingComponent';
import { isIdNotSaved } from '../../../data/common';
import { loadByTabSpaceId as noteLoadByTabSpaceId } from '../../../data/note/bootstrap';
import { startMonitorLocalStorageChanges as noteStartMonitorLocalStorageChanges } from '../../../data/note/SavedNoteStore';
import { observer } from 'mobx-react-lite';
import { loadByTabSpaceId as todoLoadByTabSpaceId } from '../../../data/todo/bootstrap';
import { startMonitorLocalStorageChanges as todoStartMonitorLocalStorageChanges } from '../../../data/todo/SavedTodoStore';

enum RightSideModule {
  TODO = 'todo',
  NOTE = 'note',
  BOOKMARK = 'bookmark',
}

export interface ITabSpaceRightSideViewProps {
  tabSpace: TabSpace;
}

export const TabSpaceRightSideView = observer(
  ({ tabSpace }: ITabSpaceRightSideViewProps) => {
    const [pinned, setPinned] = useState<string>(RightSideModule.TODO);

    const rightSideModules = useMemo(() => {
      const todoLoader = async () => {
        await todoLoadByTabSpaceId(tabSpace.id);
        const allTodoData = getAllTodoData();
        if (isIdNotSaved(tabSpace.id)) {
          todoStartMonitorLocalStorageChanges(allTodoData.allTodo);
        }
        return allTodoData;
      };
      const TodoWithLoading = getLoadingComponent(
        TodoView,
        todoLoader,
        'allTodoData',
      );

      const bookmarkLoader = async () => {
        await bookmarkLoadByTabSpaceId(tabSpace.id);
        const allBookmarkData = getAllBookmarkData();
        if (isIdNotSaved(tabSpace.id)) {
          bookmarkStartMonitorLocalStorageChanges(allBookmarkData.allBookmark);
        }
        return allBookmarkData;
      };
      const BookmarkWithLoading = getLoadingComponent(
        BookmarkView,
        bookmarkLoader,
        'allBookmarkData',
      );

      const noteLoader = async () => {
        await noteLoadByTabSpaceId(tabSpace.id);
        const allNoteData = getAllNoteData();
        if (isIdNotSaved(tabSpace.id)) {
          noteStartMonitorLocalStorageChanges(allNoteData.allNote);
        }
        return allNoteData;
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

    const unpinCurrentTool = useMemo(
      () => () => {
        setPinned(null);
        setCurrentUnpinned(pinned);
      },
      [],
    );

    const pinCurrentTool = useMemo(
      () => () => {
        setPinned(currentUnpinned);
        const restUnpinned = Object.keys(rightSideModules).filter(
          (k) => k !== currentUnpinned,
        );
        setCurrentUnpinned(restUnpinned[0]);
      },
      [],
    );

    const unpinned = Object.keys(rightSideModules).filter((k) => k !== pinned);

    return (
      <ErrorBoundary>
        <div className={classes.container}>
          {isIdNotSaved(tabSpace.id) ? (
            <div className={classes.localStorageWarning}>
              Using local storage for saving data from tools here. To save with
              current Tabverse, simply save Tabverse.
            </div>
          ) : (
            ''
          )}
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
  },
);
