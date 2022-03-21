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
import {
  getLoadingComponent,
  getLoadingComponent2,
} from '../../common/LoadingComponent';
import { isIdNotSaved } from '../../../data/common';
import { loadByTabSpaceId as noteLoadByTabSpaceId } from '../../../data/note/bootstrap';
import { startMonitorLocalStorageChanges as noteStartMonitorLocalStorageChanges } from '../../../data/note/SavedNoteStore';
import { observer } from 'mobx-react-lite';
import { loadAllTodoByTabSpaceId } from '../../../data/todo/util';

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
        await loadAllTodoByTabSpaceId(tabSpace.id);
      };
      const TodoWithLoading = getLoadingComponent2(TodoView, todoLoader);
      const todoTitle = (
        <span>
          <Icon icon="confirm" /> Todo
        </span>
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
      const bookmarkTitle = (
        <span>
          <Icon icon="book" /> Bookmark
        </span>
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
      const notebookTitle = (
        <span>
          <Icon icon="clipboard" /> Note
        </span>
      );

      return {
        [RightSideModule.TODO]: {
          component: TodoWithLoading,
          title: todoTitle,
        },
        [RightSideModule.NOTE]: {
          component: NotebookWithLoading,
          title: notebookTitle,
        },
        [RightSideModule.BOOKMARK]: {
          component: BookmarkWithLoading,
          title: bookmarkTitle,
        },
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

    console.log(
      `current pinned: ${pinned} and unpinned: ${unpinned}, tabSpaceId: ${tabSpace.id}`,
    );

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
                renderActiveTabPanelOnly={true}
                selectedTabId={pinned}
                className={classes.bpTabs}
              >
                <BPTab
                  id={pinned}
                  title={rightSideModules[pinned].title}
                  panel={React.createElement(
                    rightSideModules[pinned].component,
                    {
                      tabSpaceId: tabSpace.id,
                    },
                  )}
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
              renderActiveTabPanelOnly={true}
              onChange={(newTabId: string) => setCurrentUnpinned(newTabId)}
              selectedTabId={currentUnpinned}
              className={classes.bpTabs}
            >
              {unpinned.map((key) => {
                const componentClass = rightSideModules[key].component;
                return (
                  <BPTab
                    key={key}
                    id={key}
                    title={rightSideModules[key].title}
                    panel={React.createElement(componentClass, {
                      tabSpaceId: tabSpace.id,
                    })}
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
