import { Button, Drawer, Spinner } from '@blueprintjs/core';
import React, { useState } from 'react';
import { useUnit } from 'effector-react';

import {
  SplitBlock,
  TabGroupBlock,
} from '../../../src/ui/manager/TabSpace/TabGroupBlock';
import { TabCard } from '../../../src/ui/manager/TabSpace/TabCard';
import { TabverseSummary } from '../../../src/ui/manager/SavedTabSpace/TabverseSummary';
import { tabverseEntries } from '../../../src/data/tabSpace/tabEntries';
import type { Tab } from '../../../src/data/tabSpace/Tab';

import { deleteTabspace, dismissTabspace } from '../data/actions';
import { ago, dateOf, bytes, jsonSize } from '../data/format';
import { $account } from '../data/stores/accounts';
import { $bundle, $bundleError, $drawerOpen } from '../data/stores/drawer';
import { $isAssumed } from '../data/stores/session';
import { storedCount } from '../data/tabverseView';
import { toTabSpace } from '../data/tabverseAdapter';
import type { TabspaceBundle } from '../data/types';
import { TypedConfirmDialog } from '../components/Dialogs';
import classes from '../drawer.module.scss';

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
      size="min(720px, 92vw)"
      title={title}
      icon="layers"
      canEscapeKeyClose={true}
    >
      <div className={classes.drawer}>
        {bundle ? (
          <>
            <div className={classes.head}>
              <p className={classes.meta}>{meta}</p>
              {/* Created and saved, the way the extension states them: how long
                  ago, with the exact timestamp underneath for when it matters. */}
              <div className={classes.times}>
                <When label="Created" ms={bundle.tabspace.created_at} />
                <When label="Saved" ms={bundle.tabspace.updated_at} />
              </div>
            </div>

            <TabverseBody bundle={bundle} />

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
 * The tabverse's own list: the summary line, the tabs, and everything else it
 * carries folded away.
 *
 * Exported on its own because the drawer around it is a Blueprint `Portal`, and
 * a portal renders nothing under `renderToStaticMarkup` - which is how these
 * views are tested without a DOM (adr/0018, decision 8).
 */
export function TabverseBody(props: { bundle: TabspaceBundle }) {
  const bundle = props.bundle;
  const tabSpace = toTabSpace(bundle);
  // The same builder the extension's own saved-tabverse list uses, on the same
  // shape: a group is a block at its first member and a split view is one
  // block of two (adr/0019).
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
    <div className={classes.body}>
      <TabverseSummary
        tabCount={tabSpace.tabs.size}
        groupCount={tabSpace.tabGroups.length}
      />

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

      <StoredSections bundle={bundle} />
    </div>
  );
}

/**
 * Everything else the tabverse carries is folded away: the extension's own view
 * stops at the tabs, and an operator who wants the notes is looking for
 * something specific enough to click once.
 */
function StoredSections(props: { bundle: TabspaceBundle }) {
  const b = props.bundle;
  const total = storedCount(b);
  return (
    <details className={classes.more}>
      <summary>
        notes, todos, bookmarks and closed tabs stored with it ({total})
      </summary>

      <div className={classes.section}>
        <div className={classes.sectionTitle}>
          Notes <span className={classes.countPill}>{b.notes.length}</span>
        </div>
        {!b.notes.length ? (
          <p className="empty-inline">no notes</p>
        ) : (
          b.notes.map((note) => (
            <div className={classes.noteBody} key={note.id}>
              <div className={classes.noteName}>
                {note.data.name || '(untitled)'}
              </div>
              <div className={classes.noteText}>{note.data.data || ''}</div>
            </div>
          ))
        )}
      </div>

      <TodoSection todos={b.todos} />
      <BookmarkSection bookmarks={b.bookmarks} />

      <div className={classes.section}>
        <div className={classes.sectionTitle}>
          Closed tabs (history){' '}
          <span className={classes.countPill}>{b.closed_tabs.length}</span>
        </div>
        {!b.closed_tabs.length ? (
          <p className="empty-inline">no closed tabs recorded</p>
        ) : (
          <ul className={classes.rows}>
            {b.closed_tabs.map((closed) => (
              <li className={classes.row} key={closed.id}>
                <span className={classes.rowText}>
                  {closed.data.title || closed.data.url || '(untitled)'}
                </span>
                {closed.data.url ? (
                  <a
                    className={classes.rowUrl}
                    href={closed.data.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {closed.data.url}
                  </a>
                ) : null}
                {closed.data.closedAt ? (
                  <span className={classes.rowUrl}>
                    {ago(closed.data.closedAt)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className={classes.section}>
        <summary>ordering aggregates (raw)</summary>
        <pre className={classes.payload}>
          {JSON.stringify(b.aggregates, null, 2)}
        </pre>
      </details>
    </details>
  );
}

function TodoSection(props: { todos: TabspaceBundle['todos'] }) {
  return (
    <div className={classes.section}>
      <div className={classes.sectionTitle}>
        Todos <span className={classes.countPill}>{props.todos.length}</span>
      </div>
      {!props.todos.length ? (
        <p className="empty-inline">no todos</p>
      ) : (
        <ul className={classes.rows}>
          {props.todos.map((todo) => (
            <li
              className={`${classes.row} ${todo.data.completed ? classes.done : ''}`}
              key={todo.id}
            >
              <span className="badge">{todo.data.completed ? '✓' : '○'}</span>
              <span className={classes.rowText}>
                {todo.data.content || '(empty)'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BookmarkSection(props: { bookmarks: TabspaceBundle['bookmarks'] }) {
  return (
    <div className={classes.section}>
      <div className={classes.sectionTitle}>
        Bookmarks{' '}
        <span className={classes.countPill}>{props.bookmarks.length}</span>
      </div>
      {!props.bookmarks.length ? (
        <p className="empty-inline">no bookmarks</p>
      ) : (
        <ul className={classes.rows}>
          {props.bookmarks.map((bookmark) => (
            <li className={classes.row} key={bookmark.id}>
              <span className={classes.rowText}>
                {bookmark.data.name || bookmark.data.url || '(unnamed)'}
              </span>
              {bookmark.data.url ? (
                <a
                  className={classes.rowUrl}
                  href={bookmark.data.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {bookmark.data.url}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
