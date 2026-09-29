import {
  Intent,
  Menu,
  MenuItem,
  Popover,
  Tag,
  TagProps,
} from '@blueprintjs/core';
import { QueryScope, QueryScopeMap } from '../../../data/search/Query';

import React from 'react';
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
      <Popover placement="bottom" content={getContent()}>
        <Tag
          large={false}
          round={true}
          intent={props.intent}
          rightIcon="caret-down"
        >
          {props.value}
        </Tag>
      </Popover>
    </span>
  );
}
