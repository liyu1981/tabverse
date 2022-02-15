import * as React from 'react';

import { Intent, Menu, MenuItem, Tag, TagProps } from '@blueprintjs/core';
import { QueryScope, QueryScopeMap } from '..';

import { Popover2 } from '@blueprintjs/popover2';
import classes from './ScopeTagView.module.scss';

export type ScopeTagViewProps = TagProps & {
  intent: Intent;
  value: string;
  scopeMap: QueryScopeMap;
  onChangeScope: (newScope: QueryScope) => void;
};

export function ScopeTagView(props: ScopeTagViewProps) {
  const getContent = () => {
    const menuItems = Object.keys(props.scopeMap).map((name) => {
      return (
        <MenuItem
          key={name}
          text={name}
          onClick={() => props.onChangeScope(props.scopeMap[name])}
        ></MenuItem>
      );
    });
    return (
      <div className={classes.scopeViewTagMenuContainer}>
        <Menu>{menuItems}</Menu>
      </div>
    );
  };

  return (
    <span className={classes.scopeViewTagContainer}>
      <Popover2 placement="bottom" content={getContent()}>
        <Tag
          large={false}
          round={true}
          intent={props.intent}
          rightIcon="caret-down"
        >
          {props.value}
        </Tag>
      </Popover2>
    </span>
  );
}
