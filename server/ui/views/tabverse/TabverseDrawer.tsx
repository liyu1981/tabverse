import { Button, Drawer, Spinner } from '@blueprintjs/core';
import React, { useState } from 'react';
import { useUnit } from 'effector-react';

import {
  SplitBlock,
  TabGroupBlock,
} from '../../../../src/ui/manager/TabSpace/TabGroupBlock';
import { TabCard } from '../../../../src/ui/manager/TabSpace/TabCard';
import { TabverseSummary } from '../../../../src/ui/manager/SavedTabSpace/TabverseSummary';
import { tabverseEntries } from '../../../../src/data/tabSpace/tabEntries';
import type { Tab } from '../../../../src/data/tabSpace/Tab';

import { deleteTabspace, dismissTabspace } from '../../data/actions';
import { ago, dateOf, bytes, jsonSize } from '../../data/format';
import { $account } from '../../data/stores/accounts';
import { $bundle, $bundleError, $drawerOpen } from '../../data/stores/drawer';
import { $isAssumed } from '../../data/stores/session';
import { storedRecords, toTabSpace } from '../../data/tabverseAdapter';
import type { TabspaceBundle } from '../../data/types';
import { TypedConfirmDialog } from '../../components/Dialogs';
import { TabverseRecords } from './TabverseRecords';
import classes from './tabverse.module.scss';

/**
 * One tabverse, in a drawer over the account.
 *
 * The console browses a whole account at a time, and a tabverse used to replace
 * that whole account to show itself: you lost the list you were picking from,
 * the account you were looking at and the tab you were on. A drawer keeps all
 * three, so the answer to "what is in this one?" never costs the context it was
 * asked in.
 *
 * The action buttons of the extension's own saved-tabverse view are gone on
 * purpose. "Load to New Window", "Load to Current" and "Switch to Tabverse" all
 * act on *this* browser, and a tab stored on this account is not openable here
 * - the buttons would be decoration that cannot work. What is left is the one
 * action that is about the stored data rather than about the browser: deleting
 * it (adr/0015).
 */
export function TabverseDrawer() {
  const { open, bundle, error, account, assumed } = useUnit({
    open: $drawerOpen,
    bundle: $bundle,
    error: $bundleError,
    account: $account,
    assumed: $isAssumed,
  });
  const [deleting, setDeleting] = useState(false);

  const close = () => {
    setDeleting(false);
    dismissTabspace();
  };

  const title = bundle?.tabspace.name || '(unnamed tabverse)';
  const meta = bundle
    ? `${bundle.tabspace.id} · rev ${bundle.tabspace.rev} · updated ${ago(
        bundle.tabspace.updated_at,
      )} · ${bytes(jsonSize(bundle))}`
    : '';

  return (
    <Drawer
      isOpen={open}
      onClose={close}
      position="right"
      // wide enough for the two panes the extension draws side by side
      size="min(1180px, 96vw)"
      title={title}
      icon="layers"
      canEscapeKeyClose={true}
    >
      <div className={classes.drawer}>
        {bundle ? (
          <>
            <div className={classes.head}>
              <p className={classes.meta}>{meta}</p>
            </div>

            {/* The extension draws a tabverse as two columns: the tabs, and the
                tools that belong to it. Same here, for the same reason - the
                tools are per tabverse, so they belong beside it rather than
                folded underneath. */}
            <div className={classes.split}>
              <TabverseTabs bundle={bundle} />
              <TabverseRecords {...storedRecords(bundle)} />
            </div>

            {/* One action, on its own line at the bottom: the drawer is read
                most of the time, and a delete that sits next to the content
                invites mis-clicks. Looking through somebody else's account is
                read only, and the server refuses the delete with 403 anyway
                (adr/0014), so it is not offered. */}
            {!assumed && account ? (
              <div className={classes.foot}>
                <Button
                  icon="trash"
                  intent="danger"
                  onClick={() => setDeleting(true)}
                >
                  Delete tabverse
                </Button>
              </div>
            ) : null}

            <TypedConfirmDialog
              isOpen={deleting}
              title="Delete this tabverse"
              expected={bundle.tabspace.name || bundle.tabspace.id}
              body={
                `Deleting "${bundle.tabspace.name || bundle.tabspace.id}" removes the tabverse, its ` +
                `${bundle.tabs.length} tab(s) and everything stored with it (notes, todos, bookmarks, ` +
                'closed tabs).\n\nEvery device of this account deletes its own copy on the next sync.'
              }
              onCancel={() => setDeleting(false)}
              onConfirm={async () => {
                setDeleting(false);
                if (account)
                  await deleteTabspace(account.user.id, bundle.tabspace.id);
              }}
            />
          </>
        ) : error ? (
          <div className={classes.body}>
            <p className="empty-inline">{error}</p>
          </div>
        ) : (
          <div className={classes.body}>
            <Spinner size={24} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function When(props: { label: string; ms: number }) {
  return (
    <div className={classes.when}>
      <span className="muted small">{props.label}</span>
      <div>
        <b>{ago(props.ms)}</b>
      </div>
      <div className="muted small">{dateOf(props.ms)}</div>
    </div>
  );
}

/**
 * The left side: the tabverse's header, then its tabs.
 *
 * The header is the extension's, minus everything that is about this browser's
 * live window rather than about the stored record - no "Saved 3m ago" indicator,
 * no save-and-close, no filter box over tabs that are not open here, and no
 * Chrome-version warning: a tabverse stored on a server says nothing about the
 * browser reading it (the extension's `CapabilityWarning` exists because those
 * features are missing *here*).
 *
 * Exported on its own because the drawer around it is a Blueprint `Portal`, and
 * a portal renders nothing under `renderToStaticMarkup` - which is how these
 * views are tested without a DOM (adr/0018, decision 8).
 */
export function TabverseTabs(props: { bundle: TabspaceBundle }) {
  const bundle = props.bundle;
  const tabSpace = toTabSpace(bundle);
  // The same builder the extension's own tabverse lists use, on the same shape:
  // a group is a block at its first member and a split view is one block of two
  // (adr/0019).
  const entries = tabverseEntries(tabSpace);

  // Opening a stored tab is the one thing a card can do that is about this
  // browser rather than about the account, and it is a plain link: there is no
  // window here to switch to.
  const openTab = (tab: Tab) => {
    if (tab.url) window.open(tab.url, '_blank', 'noreferrer');
  };

  const storedCard = (tab: Tab) => (
    <TabCard key={tab.id} tab={tab} onActivate={openTab} />
  );

  return (
    <div className={classes.pane}>
      <div className={classes.paneHeader}>
        <h1 className={classes.paneTitle}>{tabSpace.name || '(untitled)'}</h1>
        {/* Created and saved, the way the extension states them: how long ago,
            with the exact timestamp underneath for when it matters. */}
        <div className={classes.times}>
          <When label="Created" ms={tabSpace.createdAt} />
          <When label="Saved" ms={tabSpace.updatedAt} />
        </div>
        <TabverseSummary
          tabCount={tabSpace.tabs.size}
          groupCount={tabSpace.tabGroups.length}
        />
      </div>

      <div className={classes.paneBody}>
        {!tabSpace.tabs.size ? (
          <p className="empty-inline">no tabs in this tabverse</p>
        ) : (
          <div className={classes.cards}>
            {entries.map((entry) => {
              if (entry.kind === 'tab') return storedCard(entry.tab);
              if (entry.kind === 'split') {
                const [first, second] = entry.tabs as [Tab, Tab];
                return (
                  <SplitBlock
                    key={`split-${first.id}`}
                    splitViewId={first.splitViewId}
                  >
                    {storedCard(first)}
                    {storedCard(second)}
                  </SplitBlock>
                );
              }
              return (
                <TabGroupBlock
                  key={`group-${entry.group.id}`}
                  group={entry.group}
                  tabCount={entry.tabs.length}
                >
                  {entry.tabs.map(storedCard)}
                </TabGroupBlock>
              );
            })}
          </div>
        )}

        {/* The raw ordering lists, for a record nobody can make sense of any
            other way. The extension has no such thing; somebody reading
            another account's data does. */}
        <details className={classes.more}>
          <summary>ordering aggregates (raw)</summary>
          <pre className={classes.payload}>
            {JSON.stringify(bundle.aggregates, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
