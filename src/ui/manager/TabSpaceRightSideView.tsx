import * as React from 'react';

import { Tab as BPTab, Tabs as BPTabs, Icon } from '@blueprintjs/core';

import { BookmarkView } from '../bookmark/BookmarkView';
import { NotebookView } from '../notebook/NotebookView';
import { TabSpace } from '../../data/tabSpace/tabSpace';
import { TodoView } from '../todo/TodoView';
import { getAllBookmarkData } from '../../data/bookmark/bootstrap';
import { getAllNoteData } from '../../data/note/bootstrap';
import { getAllTodoData } from '../../data/todo/bootstrap';

export interface ITabSpaceRightSideViewProps {
  tabSpace: TabSpace;
}

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      marginTop: '72px',
    },
    tabsContainer: {
      marginBottom: '50px',
    },
    card: {
      padding: '8px 12px',
      width: '100%',
    },
    wrapText: {
      overflowWrap: 'anywhere',
    },
  };
}

export const TabSpaceRightSideView = (props: ITabSpaceRightSideViewProps) => {
  const styles = createStyles();
  return (
    <div style={styles.container}>
      <div style={styles.tabsContainer}>
        <BPTabs animate={true} renderActiveTabPanelOnly={false}>
          <BPTab
            id="todo"
            title={
              <span>
                <Icon icon="confirm" /> Todo
              </span>
            }
            panel={<TodoView allTodoData={getAllTodoData()} />}
          />
        </BPTabs>
      </div>
      <div style={styles.tabsContainer}>
        <BPTabs animate={true} renderActiveTabPanelOnly={false}>
          <BPTab
            id="note"
            title={
              <span>
                <Icon icon="clipboard" /> Note
              </span>
            }
            panel={<NotebookView allNoteData={getAllNoteData()} />}
          />
          <BPTab
            id="bookmark"
            title={
              <span>
                <Icon icon="book" /> Bookmark
              </span>
            }
            panel={<BookmarkView allBookmarkData={getAllBookmarkData()} />}
          />
        </BPTabs>
      </div>
    </div>
  );
};
