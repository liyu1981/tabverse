import { Tab as BPTab, Tabs as BPTabs, Button, Icon } from '@blueprintjs/core';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { BookmarkView } from '../../bookmark/BookmarkView';
import { ErrorBoundary } from '../../common/ErrorBoundary';
import { HistoryView } from '../../history/HistoryView';
import { NotebookView } from '../../notebook/NotebookView';
import { TodoView } from '../../todo/TodoView';
import classes from './TabSpaceRightSideView.module.scss';
import { getLoadingComponent2 } from '../../common/LoadingComponent';
import { loadAllTodoByTabSpaceId } from '../../../data/todo/util';
import { loadAllNoteByTabSpaceId } from '../../../data/note/util';
import { loadAllBookmarkByTabSpaceId } from '../../../data/bookmark/util';
import { loadClosedTabsByTabSpaceId } from '../../../data/closedTab/util';
import { loadChat } from '../../../data/aiChat/runtime';
import {
  ToolTabMsg,
  subscribePubSubMessage,
  unsubscribePubSubMessage,
} from '../../../message/message';
import { ChatPanel } from './ChatPanel';
import { useSettingItem } from '../../../storage/localSetting';
import { useStore } from 'effector-react';
import { $tabSpace } from '../../../data/tabSpace/store';

enum RightSideModule {
  TODO = 'todo',
  NOTE = 'note',
  BOOKMARK = 'bookmark',
  HISTORY = 'history',
  CHAT = 'chat',
}

/**
 * Window-local: which tool is pinned, so a reload puts it back. The right side
 * panel remembers its own open view the same way (`RightSidePanel`), and the
 * history remembers its group switch.
 */
const PINNED_TOOL_SETTING = 'tabverse_pinned_tool';

/** The stored value for "nothing is pinned", distinct from "never set". */
const NO_PINNED_TOOL = 'none';

/**
 * The stored setting as a pin. `undefined` (never set - first visit) and a key
 * that is no longer a tool both fall back to the default, so a stale value
 * cannot render a tab that is not there; `NO_PINNED_TOOL` is the person having
 * unpinned every tool.
 */
function pinnedFromSetting(stored: string | undefined): string | null {
  if (stored === NO_PINNED_TOOL) {
    return null;
  }
  return (Object.values(RightSideModule) as string[]).includes(stored as string)
    ? (stored as string)
    : RightSideModule.TODO;
}

export function TabSpaceRightSideView() {
  const tabSpace = useStore($tabSpace);
  // null means nothing is pinned: the pinned row disappears and every tool
  // moves back into the single scrolling list
  const [pinnedSetting, setPinnedSetting] = useSettingItem<string>(
    PINNED_TOOL_SETTING,
    (value) => value,
    (value) => value,
  );
  const pinned = pinnedFromSetting(pinnedSetting);

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
      await loadAllBookmarkByTabSpaceId(tabSpace.id);
    };
    const BookmarkWithLoading = getLoadingComponent2(
      BookmarkView,
      bookmarkLoader,
    );
    const bookmarkTitle = (
      <span>
        <Icon icon="book" /> Bookmark
      </span>
    );

    const notebookLoader = async () => {
      await loadAllNoteByTabSpaceId(tabSpace.id);
    };
    const NotebookWithLoading = getLoadingComponent2(
      NotebookView,
      notebookLoader,
    );
    const notebookTitle = (
      <span>
        <Icon icon="clipboard" /> Note
      </span>
    );

    const historyLoader = async () => {
      await loadClosedTabsByTabSpaceId(tabSpace.id);
    };
    const HistoryWithLoading = getLoadingComponent2(HistoryView, historyLoader);
    const historyTitle = (
      <span>
        <Icon icon="history" /> History
      </span>
    );

    // The AI chat is here rather than in the right side panel: it is about this
    // tabverse's work, like the other tools, not about the tooling around it.
    // `loadChat` reads the stored conversation once; it is a no-op after that.
    const ChatWithLoading = getLoadingComponent2(ChatPanel, loadChat);
    const chatTitle = (
      <span>
        <Icon icon="comment" /> AI Chat
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
      [RightSideModule.HISTORY]: {
        component: HistoryWithLoading,
        title: historyTitle,
      },
      [RightSideModule.CHAT]: {
        component: ChatWithLoading,
        title: chatTitle,
      },
    };
  }, [tabSpace.id]);

  const [currentUnpinned, setCurrentUnpinned] = useState<string>(() => {
    const restUnpinned = Object.keys(rightSideModules).filter(
      (k) => k !== pinned,
    );
    return restUnpinned[0];
  });

  // A tab action ("send page content to AI chat", `TabContentButton`) asks for
  // the chat. Keep the latest pinned tool in a ref so the one subscription does
  // not re-subscribe on every pin; when the chat is already the pinned tool it
  // is on screen, and moving the unpinned selection to it would leave the
  // selection pointing at a tab that is not in that strip.
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  useEffect(() => {
    const token = subscribePubSubMessage(ToolTabMsg.OpenChat, () => {
      if (pinnedRef.current !== RightSideModule.CHAT) {
        setCurrentUnpinned(RightSideModule.CHAT);
      }
    });
    return () => unsubscribePubSubMessage(token);
  }, []);

  const unpinCurrentTool = () => {
    setPinnedSetting(NO_PINNED_TOOL);
    setCurrentUnpinned(pinned);
  };

  const pinCurrentTool = () => {
    setPinnedSetting(currentUnpinned);
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
          <div
            className={`${classes.tabsContainer} ${classes.pinnedContainer}`}
          >
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
                  {},
                )}
              />
            </BPTabs>
          </div>
        ) : (
          ''
        )}
        <div
          className={`${classes.tabsContainer} ${classes.unpinnedContainer}`}
        >
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
                  panel={React.createElement(componentClass, {})}
                />
              );
            })}
          </BPTabs>
        </div>
      </div>
    </ErrorBoundary>
  );
}
