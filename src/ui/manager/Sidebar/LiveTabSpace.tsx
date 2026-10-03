import React from 'react';
import { useStore } from 'effector-react';

import classes from './LiveTabSpace.module.scss';
import { $tabSpace } from '../../../data/tabSpace/store';
import type { SidebarComponentProps } from './Sidebar';

export type LiveTabSpaceProps = SidebarComponentProps;

/**
 * The tabverse of this window: its name, and nothing else.
 *
 * The entry above already says "Current Tabverse", so the old "In This Window"
 * heading said the same thing twice. The name is truncated because a tabverse
 * can be called anything and the sidebar's width is not negotiable; the full
 * name is in the title attribute, and in the collapsed rail's tooltip.
 */
export function LiveTabSpace(props: LiveTabSpaceProps) {
  const tabSpace = useStore($tabSpace);
  // a tabverse is named `Window-<id>` from its first second (tabSpaceBootstrap),
  // so this only matters before that write lands: an id beats an empty row
  const label = tabSpace.name.length > 0 ? tabSpace.name : tabSpace.id;

  return (
    <div className={classes.currentName} title={label}>
      {label}
    </div>
  );
}
