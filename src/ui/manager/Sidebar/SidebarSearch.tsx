import { InputGroup, Keys } from '@blueprintjs/core';
import * as React from 'react';
import classes from './SidebarSearch.module.scss';
import SidebarClasses from './Sidebar.module.scss';
import clsx from 'clsx';
import { ManagerViewRoute } from '../ManagerView';
import { useMemo, useRef } from 'react';

export interface SidebarSearchProps {
  active: boolean;
  onSwitch: (route: ManagerViewRoute) => void;
}

export function SidebarSearch(props: SidebarSearchProps) {
  const inputRef = useRef<HTMLInputElement>();

  const onKeyDown = useMemo(
    () => (event: React.KeyboardEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget;
      if (event.which === Keys.ENTER && value.length > 0) {
        props.onSwitch(ManagerViewRoute.Search);
      }
    },
    [],
  );

  const onFocus = useMemo(
    () => () => {
      if (
        inputRef &&
        inputRef.current &&
        inputRef.current.value.trim().length > 0
      ) {
        props.onSwitch(ManagerViewRoute.Search);
      }
    },
    [],
  );

  return (
    <div
      className={clsx(
        SidebarClasses.sidebarComponent,
        props.active ? SidebarClasses.active : SidebarClasses.inactive,
        classes.sidebarSearchContainer,
      )}
    >
      <div className={SidebarClasses.edge}> </div>
      <div className={classes.sidebarSearchInnerContainer}>
        <InputGroup
          inputRef={inputRef}
          leftIcon="search"
          placeholder=" keyword + ↵ to search"
          onKeyDown={onKeyDown}
          onFocus={onFocus}
        ></InputGroup>
      </div>
    </div>
  );
}
