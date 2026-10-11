/**
 * The one settings dialog (adr/0020's sync setup and the about panel, merged).
 *
 * It hosts sections as *tabs whose triggers are the left column* - the vertical
 * `Tabs` Blueprint draws - because the sections are peers a person moves
 * between, not steps in a wizard: the sync setup is long, the on-device AI
 * section is a status page, and the about panel is a surface; none of them
 * wants to be a nested dialog of another.
 *
 * The right hand panel scrolls, the rail does not: a long section (the sync
 * form with its status) must not take the section list off screen.
 *
 * The sync section keeps its own two tabs (Status / Setup) - those are steps in
 * one task, so they stay the horizontal pair they always were.
 */
import { Dialog, DialogBody, Icon, Tab, Tabs } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React, { useEffect, useState } from 'react';

import { AboutPanel } from './AboutPanel';
import { AiSettingsPanel } from './AiSettingsPanel';
import { ServerSyncPanel } from './ServerSyncPanel';
import { SuspendSettingsPanel } from './SuspendSettingsPanel';
import classes from './SettingsDialog.module.scss';

export type SettingsTab = 'sync' | 'suspend' | 'ai' | 'about';

export interface SettingsBodyProps {
  tab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
}

/**
 * The dialog's content, on its own so it can be rendered without a DOM.
 *
 * Blueprint's `Dialog` goes through a `Portal`, and a portal renders nothing
 * under `renderToStaticMarkup` (adr/0018, decision 8: this repo's views are
 * checked by what they render, and a `Dialog` is not one of them). The wrap
 * around this - the dialog itself - is what the browser checks.
 */
export function SettingsBody(props: SettingsBodyProps) {
  return (
    <DialogBody className={classes.body}>
      <Tabs
        id="settings-tabs"
        vertical={true}
        animate={false}
        renderActiveTabPanelOnly={true}
        selectedTabId={props.tab}
        onChange={(next) => props.onSelectTab(next as SettingsTab)}
      >
        <Tab
          id="sync"
          title={
            <span>
              <Icon icon="refresh" /> Sync
            </span>
          }
          panel={<ServerSyncPanel />}
        />
        <Tab
          id="suspend"
          title={
            <span>
              <Icon icon="pause" /> Tabs
            </span>
          }
          panel={<SuspendSettingsPanel />}
        />
        <Tab
          id="ai"
          title={
            <span>
              <Icon icon="lightbulb" /> AI
            </span>
          }
          panel={<AiSettingsPanel />}
        />
        <Tab
          id="about"
          title={
            <span>
              <Icon icon="help" /> About
            </span>
          }
          panel={<AboutPanel />}
        />
      </Tabs>
    </DialogBody>
  );
}

export interface SettingsDialogProps {
  isOpen: boolean;
  /**
   * Which section to open on. The bottom bar has a button per section (the
   * sync one, which also reports activity, and the version/about one), and each
   * opens the dialog on what it is about.
   */
  initialTab?: SettingsTab;
  onClose: () => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { isOpen, initialTab = 'sync', onClose } = props;
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // The dialog is mounted for the page's life and only shown or hidden, so the
  // section has to follow whichever button opened it - otherwise the second
  // open would land on the tab the first one left behind.
  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
    }
  }, [isOpen, initialTab]);

  return (
    <Dialog
      className={classes.dialog}
      isOpen={isOpen}
      onClose={onClose}
      canOutsideClickClose={true}
      icon="cog"
      title="Settings"
    >
      <SettingsBody tab={tab} onSelectTab={setTab} />
    </Dialog>
  );
}
