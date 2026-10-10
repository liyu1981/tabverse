/**
 * The right side panel: the rail on the right edge of the manager page, and
 * the panel it opens (adr/0025).
 *
 * It hosts the things that are about the tooling around a tabverse rather than
 * about the tabverse itself, each as a *view* selected by a button in the rail:
 *
 *   - the server console (the paired server's own UI, in an iframe),
 *   - the AI history (what this extension asked the on-device model).
 *
 * Both were, at different points, a tool tab of `TabSpaceRightSideView`. They
 * are not that: they are not per tabverse, they do not belong in the strip with
 * Todo/Note/Bookmark/History and its pinning, and they want more room than the
 * tools column. Keeping them together in one rail also means one place for
 * "which panel is open", remembered as a window-local setting.
 *
 * The panel is a column of the page, not an overlay: opening it pushes the
 * tabverse left (see ManagerView.module.scss).
 */
import { Button, Icon } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React from 'react';

import { useSettingItem } from '../../../storage/localSetting';
import { PromptHistoryPanel } from './PromptHistoryPanel';
import { ServerConsoleView } from './ServerConsolePanel';
import classes from './RightSidePanel.module.scss';

export type RightPanelView = 'ai' | 'server';

/** Remembered across reloads: which panel is open ('' = the rail). */
const PANEL_SETTING = 'tabverse_right_panel';

const VIEWS = [
  { id: 'ai', icon: 'chat', label: 'AI history' },
  { id: 'server', icon: 'cloud-server', label: 'Server console' },
] as const;

export interface RightSidePanelShellProps {
  /** null is the collapsed rail. */
  view: RightPanelView | null;
  onSelectView: (view: RightPanelView) => void;
  onCollapse: () => void;
}

/**
 * The shell, presentational so the rail and both views can be checked by what
 * they render (ADR 0019, AGENTS.md: no browser).
 */
export function RightSidePanelShell(props: RightSidePanelShellProps) {
  const { view } = props;

  if (!view) {
    return (
      <div className={classes.rail}>
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={classes.railButton}
            aria-label={`Open the ${entry.label}`}
            title={entry.label}
            onClick={() => props.onSelectView(entry.id)}
          >
            <Icon icon={entry.icon} />
          </button>
        ))}
      </div>
    );
  }

  const active = VIEWS.find((entry) => entry.id === view);

  return (
    <aside className={classes.drawer} aria-label={active.label}>
      <header className={classes.header}>
        <span className={classes.title}>
          <Icon icon={active.icon} /> {active.label}
        </span>
        <span className={classes.spacer} />
        {/* The rail's buttons again, in the header: the two views are the two
            things this panel can show, and switching should not mean closing
            it first. The active one is marked. */}
        {VIEWS.map((entry) => (
          <Button
            key={entry.id}
            minimal={true}
            small={true}
            icon={entry.icon}
            active={entry.id === view}
            aria-label={`Show the ${entry.label}`}
            title={entry.label}
            onClick={() => props.onSelectView(entry.id)}
          />
        ))}
        <Button
          minimal={true}
          small={true}
          icon="chevron-right"
          aria-label="Collapse the right panel"
          title="Collapse"
          onClick={props.onCollapse}
        />
      </header>
      <div className={classes.body}>
        {view === 'server' ? <ServerConsoleView /> : <PromptHistoryPanel />}
      </div>
    </aside>
  );
}

export function RightSidePanel() {
  const [view, setView] = useSettingItem<RightPanelView | ''>(
    PANEL_SETTING,
    (value) => (value === 'ai' || value === 'server' ? value : ''),
    (value) => value,
  );

  return (
    <RightSidePanelShell
      view={view === 'ai' || view === 'server' ? view : null}
      onSelectView={setView}
      onCollapse={() => setView('')}
    />
  );
}
