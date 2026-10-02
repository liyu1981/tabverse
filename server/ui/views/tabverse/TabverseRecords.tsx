import { Icon, Tab as BlueprintTab, Tabs } from '@blueprintjs/core';
import React, { useState } from 'react';

import rightSideClasses from '../../../../src/ui/manager/TabSpaceRightSide/TabSpaceRightSideView.module.scss';
import type {
  Bookmark,
  ClosedTab,
  Note,
  Todo,
} from '../../data/tabverseAdapter';
import classes from './tabverse.module.scss';
import { BookmarkPanel } from './BookmarkPanel';
import { HistoryPanel } from './HistoryPanel';
import { NotePanel } from './NotePanel';
import { TodoPanel } from './TodoPanel';

/**
 * The right side of a tabverse, as the extension's right side.
 *
 * Same four tools in the same order, with the same icons, on the same pill tabs
 * (`TabSpaceRightSideView.module.scss`), and none of the ways to change
 * anything: no lock to pin a tool, no "new note", no toggle-all, no delete. A
 * tabverse stored on somebody else's account is read from here, not edited -
 * ADR 0015 is the reason a record written from here would lose to the next
 * honest sync anyway, and a button that cannot work is worse than no button.
 *
 * The panels reuse the extension's four views' *stylesheets* rather than their
 * components: each of those views is an editor bound to the local database, and
 * what is worth sharing is how a todo row, a note, a bookmark row and a closed
 * tab are drawn - not the machinery around them.
 */
export type ToolId = 'todo' | 'note' | 'bookmark' | 'history';

const TOOLS: {
  id: ToolId;
  icon: 'confirm' | 'clipboard' | 'book' | 'history';
  label: string;
}[] = [
  { id: 'todo', icon: 'confirm', label: 'Todo' },
  { id: 'note', icon: 'clipboard', label: 'Note' },
  { id: 'bookmark', icon: 'book', label: 'Bookmark' },
  { id: 'history', icon: 'history', label: 'History' },
];

export interface TabverseRecordsProps {
  todos: Todo[];
  notes: Note[];
  bookmarks: Bookmark[];
  history: ClosedTab[];
}

export function TabverseRecords(props: TabverseRecordsProps) {
  // Todo first, like the extension's pinned row: it is the tool people look at
  // first, and "no tool is pinned" is a state the console does not have.
  const [selected, setSelected] = useState<ToolId>('todo');

  return (
    <div className={classes.tools}>
      <Tabs
        animate={true}
        renderActiveTabPanelOnly={true}
        selectedTabId={selected}
        onChange={(id) => setSelected(id as ToolId)}
        className={rightSideClasses.bpTabs}
      >
        {TOOLS.map((tool) => (
          <BlueprintTab
            key={tool.id}
            id={tool.id}
            title={
              <span>
                <Icon icon={tool.icon} /> {tool.label}
              </span>
            }
            panel={
              <div className={rightSideClasses.card}>
                {tool.id === 'todo' ? <TodoPanel todos={props.todos} /> : null}
                {tool.id === 'note' ? <NotePanel notes={props.notes} /> : null}
                {tool.id === 'bookmark' ? (
                  <BookmarkPanel bookmarks={props.bookmarks} />
                ) : null}
                {tool.id === 'history' ? (
                  <HistoryPanel history={props.history} />
                ) : null}
              </div>
            }
          />
        ))}
      </Tabs>
    </div>
  );
}
