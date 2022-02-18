// This file is adapted from @blueprintjs v3 tag input, we will mainly change
// the tag to our customized search condition UI.

import * as React from 'react';

import { AndQuery, QueryScope, QueryScopeMap } from '..';
import {
  Classes,
  Icon,
  IconSize,
  Keys,
  TagInputProps,
  Utils,
} from '@blueprintjs/core';
import { useRef, useState } from 'react';

import { AndQueryView } from './AndQueryView';
import { Query } from '../query';
import SearchInputClasses from './SearchInput.module.scss';
import classNames from 'classnames';

/**
 * The method in which a `TagInput` value was added.
 * - `"default"` - indicates that a value was added by manual selection.
 * - `"blur"` - indicates that a value was added when the `TagInput` lost focus.
 *   This is only possible when `addOnBlur=true`.
 * - `"paste"` - indicates that a value was added via paste. This is only
 *   possible when `addOnPaste=true`.
 */
export type SearchInputAddMethod = 'default' | 'blur' | 'paste';

export type SearchInputProps = Omit<
  TagInputProps,
  'values' | 'onChange' | 'onAdd' | 'onRemove' | 'inputValue'
> & {
  query: Query;
  scopeDefault: QueryScope;
  scopeMap: QueryScopeMap;
  onChangeQuery: (newQuery: Query) => void;
  children?: React.ReactNode;
};

export interface ISearchInputState {
  activeIndex: number;
  inputValue: string;
  isInputFocused: boolean;
  prevInputValueProp?: string;
}

/** special value for absence of active tag */
const NONE = -1;

/**
 * Splits inputValue on separator prop,
 * trims whitespace from each new value,
 * and ignores empty values.
 */
const getValues = (
  inputValue: string,
  separator?: string | RegExp | boolean,
) => {
  // NOTE: split() typings define two overrides for string and RegExp. this
  // does not play well with our union prop type, so we'll just declare it as
  // a valid type.
  return (
    separator === false
      ? [inputValue]
      : inputValue.split(separator as string | RegExp)
  )
    .map((val) => val.trim())
    .filter((val) => val.length > 0);
};

export function SearchInput(props: SearchInputProps) {
  const [inputState, setInputState] = useState({
    inputValue: '',
    isInputFocused: false,
  });
  const inputRef = useRef<HTMLInputElement>();

  const invokeKeyPressCallback = (
    propCallbackName: 'onKeyDown' | 'onKeyUp',
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    props[propCallbackName]?.(event);
    props.inputProps && props.inputProps[propCallbackName]?.(event);
  };

  const addTags = (value: string) => {
    const newValues = getValues(value, props.separator);
    const newQuery = new Query(props.query).addAndQuery(
      newValues,
      props.scopeDefault,
    );
    setInputState((lastState) => {
      return Object.assign({}, lastState, { inputValue: '' });
    });
    props.onChangeQuery(newQuery);
  };

  const handleContainerBlur = ({
    currentTarget,
  }: React.FocusEvent<HTMLDivElement>) => {
    // we only care if the blur event is leaving the container.
    // defer this check using rAF so activeElement will have updated.
    if (!currentTarget.contains(document.activeElement)) {
      if (
        props.addOnBlur &&
        inputState.inputValue !== undefined &&
        inputState.inputValue.length > 0
      ) {
        addTags(inputState.inputValue);
      }
      setInputState((lastState) => {
        return Object.assign({}, lastState, { isInputFocused: false });
      });
    }
  };

  const handleContainerClick = () => {
    inputRef.current?.focus();
  };

  const handleInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    setInputState((lastState) => {
      return Object.assign({}, lastState, { isInputFocused: true });
    });
    props.inputProps?.onFocus?.(event);
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputState((lastState) => {
      return Object.assign({}, lastState, {
        inputValue: event.target?.value,
      });
    });
    props.onInputChange?.(event);
    props.inputProps?.onChange?.(event);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;
    if (event.which === Keys.ENTER && value.length > 0) {
      addTags(value);
    }
    invokeKeyPressCallback('onKeyDown', event);
  };

  const handleInputKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    invokeKeyPressCallback('onKeyUp', event);
  };

  const maybeRenderAndQuery = (andQuery: AndQuery, index: number) => {
    if (!andQuery) {
      return null;
    }
    if (!andQuery.terms || andQuery.terms.length <= 0) {
      return null;
    }
    const { large, tagProps } = props;
    const calculatedTagProps = Utils.isFunction(tagProps)
      ? tagProps(andQuery, index)
      : tagProps;

    return (
      <AndQueryView
        andQuery={andQuery}
        scopeMap={props.scopeMap}
        onChangeAndQuery={(newAndQuery: AndQuery) => {
          props.onChangeQuery(props.query.replaceAndQuery(index, newAndQuery));
        }}
        onFocusBackToInput={handleContainerClick}
        data-tag-index={index}
        key={index}
        large={large}
        onRemove={
          props.disabled
            ? undefined
            : () => props.onChangeQuery(props.query.removeAndQuery(index))
        }
        {...calculatedTagProps}
      ></AndQueryView>
    );
  };

  const classes = classNames(
    Classes.INPUT,
    Classes.TAG_INPUT,
    {
      [Classes.ACTIVE]: inputState.isInputFocused,
      [Classes.DISABLED]: props.disabled,
      [Classes.FILL]: props.fill,
      [Classes.LARGE]: props.large,
    },
    Classes.intentClass(props.intent),
    props.className,
  );

  const isLarge = classes.indexOf(Classes.LARGE) > NONE;

  // use placeholder prop only if it's defined and values list is empty or
  // contains only falsy values
  const isSomeValueDefined = props.query && !props.query.isEmpty();
  const resolvedPlaceholder =
    props.placeholder == null || isSomeValueDefined
      ? props.inputProps?.placeholder
      : props.placeholder;

  return (
    <div className={SearchInputClasses.searchInputContainer}>
      <div
        className={classes}
        onBlur={handleContainerBlur}
        onClick={handleContainerClick}
      >
        <Icon
          className={Classes.TAG_INPUT_ICON}
          icon={props.leftIcon}
          size={isLarge ? IconSize.LARGE : IconSize.STANDARD}
        />
        <div className={Classes.TAG_INPUT_VALUES}>
          {props.query && props.query.andQueries.map(maybeRenderAndQuery)}
          {props.children}
          <input
            value={inputState.inputValue}
            {...props.inputProps}
            onFocus={handleInputFocus}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onKeyUp={handleInputKeyUp}
            placeholder={resolvedPlaceholder}
            ref={inputRef}
            className={classNames(
              Classes.INPUT_GHOST,
              props.inputProps?.className,
            )}
            disabled={props.disabled}
          />
        </div>
        {props.rightElement}
      </div>
    </div>
  );
}
