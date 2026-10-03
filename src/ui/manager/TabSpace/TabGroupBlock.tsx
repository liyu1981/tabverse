import { Tab } from '../../../data/tabSpace/Tab';
import { TabGroupHint } from '../../../data/tabSpace/TabSpace';
import { subEntriesOfTabs } from '../../../data/tabSpace/tabEntries';
import { TAB_GROUP_COLORS_JS } from '../../../data/tabSpace/tabGroup';
import React from 'react';
import classes from './TabGroupBlock.module.scss';

export interface ITabGroupBlockProps {
  group: TabGroupHint;
  /** The tabs to render inside; a group whose tabs are all gone renders empty. */
  children?: React.ReactNode;
  tabCount?: number;
}

/**
 * A tab group as a block: a coloured rule down the left and a header row with
 * the group's title and how many of its tabs are here.
 *
 * Shared by the live tab list and the saved tabverse list. The saved list used
 * to flatten a tabverse into a plain list of tabs, which is exactly the view
 * where a user is trying to remember what was in the group.
 */
export function TabGroupBlock(props: ITabGroupBlockProps) {
  const { group } = props;
  return (
    <div
      className={classes.block}
      style={{ borderColor: TAB_GROUP_COLORS_JS[group.color] }}
    >
      <div className={classes.header}>
        {/* the group's own colour is the label's background, so the dot that
            used to carry it is gone - one thing says it, not two */}
        <span
          className={classes.label}
          style={{ backgroundColor: TAB_GROUP_COLORS_JS[group.color] }}
        >
          <span className={classes.title} title={group.title}>
            {group.title || '(untitled group)'}
          </span>
        </span>
        <small className={classes.count}>
          {props.tabCount ?? group.tabIds.length}
        </small>
      </div>
      {props.children}
    </div>
  );
}

export interface IGroupTabsProps {
  /** The group's tabs, in the order the list shows them. */
  tabs: Tab[];
  /** How this host draws one card - the live list, the saved view and the console's drawer all differ. */
  card: (tab: Tab) => React.ReactNode;
}

/**
 * A group's tabs as the list reads them: ordinary cards, and a split pair as
 * one block.
 *
 * This is where a split view *inside* a group lands. `tabverseEntries` cannot
 * express it: it takes a group's tabs and stops, so a split opened in a group
 * used to draw as three plain cards - no block, and the pairing gone (which is
 * how a `github: <tab1 | tab3> + tab2` split read as `github: tab1, tab2`). The
 * three hosts each pass their own card in, so the composition is written once.
 */
export function GroupTabs(props: IGroupTabsProps) {
  return (
    <>
      {subEntriesOfTabs(props.tabs).map((sub) =>
        sub.kind === 'split' ? (
          <SplitBlock
            key={`split-${sub.tabs[0].id}`}
            splitViewId={sub.tabs[0].splitViewId}
          >
            {props.card(sub.tabs[0])}
            {props.card(sub.tabs[1])}
          </SplitBlock>
        ) : (
          props.card(sub.tab)
        ),
      )}
    </>
  );
}

export interface ISplitBlockProps {
  /** Chrome's split view id, the identity of the pair. */
  splitViewId?: number;
  children?: React.ReactNode;
}

/** The two tabs of a split view, drawn as one connected block. */
export function SplitBlock(props: ISplitBlockProps) {
  return (
    <div
      className={`${classes.block} ${classes.splitBlock}`}
      key={`split-${props.splitViewId}`}
    >
      <div className={classes.header}>
        {/* no group colour to borrow here, so the label keeps the neutral the
            block's own rule is drawn in */}
        <span className={classes.label}>
          <span aria-hidden={true}>&#9101;</span>
          <span className={classes.title}>split view</span>
        </span>
      </div>
      {props.children}
    </div>
  );
}
