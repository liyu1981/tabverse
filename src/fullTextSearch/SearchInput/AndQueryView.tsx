// start from @blueprintjs v3 Tag to build our Search And Condition

import * as React from 'react';

import {
  Classes,
  Icon,
  IconSize,
  Intent,
  TagProps,
  Utils,
} from '@blueprintjs/core';
import { QueryScope, QueryScopeMap } from '..';

import { AndQuery } from '../query';
import AndQueryViewClasses from './AndQueryView.module.scss';
import { ScopeTagView } from './ScopeTagView';
import { TermPlusView } from './TermPlusView';
import { TermsView } from './TermsView';
import classNames from 'classnames';
import { eq } from 'lodash';

export type AndQueryViewProps = Omit<TagProps, 'active'> & {
  andQuery: AndQuery;
  scopeMap: QueryScopeMap;
  onChangeAndQuery: (newAndQuery: AndQuery) => void;
  onFocusBackToInput: () => void;
};

function getScopeName(
  scopeMap: QueryScopeMap,
  scope: QueryScope,
): string | undefined {
  return Object.keys(scopeMap).find((name) => eq(scopeMap[name], scope));
}

export function AndQueryView(props: AndQueryViewProps) {
  const {
    andQuery,
    scopeMap,
    onChangeAndQuery,
    onFocusBackToInput,
    children,
    className,
    fill,
    icon,
    intent,
    interactive,
    large,
    minimal,
    multiline,
    onRemove,
    rightIcon,
    round,
    tabIndex = 0,
    elementRef,
    ...htmlProps
  } = props;

  const isRemovable = Utils.isFunction(onRemove);

  const tagClasses = classNames(
    Classes.TAG,
    Classes.intentClass(intent),
    {
      [Classes.FILL]: fill,
      [Classes.INTERACTIVE]: interactive,
      [Classes.LARGE]: large,
      [Classes.MINIMAL]: minimal,
      [Classes.ROUND]: round,
    },
    className,
    AndQueryViewClasses.andQueryView,
  );

  const isLarge = large || tagClasses.indexOf(Classes.LARGE) >= 0;

  const onRemoveClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onRemove?.(e, props);
  };

  const removeButton = isRemovable ? (
    <button
      aria-label="Remove"
      type="button"
      className={Classes.TAG_REMOVE}
      onClick={onRemoveClick}
      tabIndex={interactive ? tabIndex : undefined}
    >
      <Icon
        icon="small-cross"
        size={isLarge ? IconSize.LARGE : IconSize.STANDARD}
      />
    </button>
  ) : null;

  const onChangeScope = (newScope: QueryScope) => {
    onChangeAndQuery({ scope: newScope, terms: andQuery.terms });
  };

  const onAddTerms = (terms: string[]) => {
    onChangeAndQuery({
      scope: andQuery.scope,
      terms: andQuery.terms.concat(terms),
    });
  };

  const onRemoveTerm = (index: number) => {
    onChangeAndQuery({
      scope: andQuery.scope,
      terms: andQuery.terms.filter((_t, i) => i !== index),
    });
  };

  return (
    <span className={AndQueryViewClasses.andQueryViewContainer}>
      <span
        {...htmlProps}
        className={tagClasses}
        tabIndex={interactive ? tabIndex : undefined}
        ref={elementRef}
      >
        <Icon icon={icon} />
        <ScopeTagView
          intent={Intent.PRIMARY}
          value={getScopeName(scopeMap, andQuery.scope)}
          scopeMap={scopeMap}
          onChangeScope={onChangeScope}
        />
        <span>contains all of</span>
        <TermsView values={andQuery.terms} onRemoveTerm={onRemoveTerm} />
        <TermPlusView
          onFocusBackToInput={onFocusBackToInput}
          onAddTerms={onAddTerms}
        />
        <Icon icon={rightIcon} />
        {removeButton}
      </span>
    </span>
  );
}
