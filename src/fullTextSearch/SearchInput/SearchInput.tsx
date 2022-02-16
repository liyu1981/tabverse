// This file is adapted from @blueprintjs v3 tag input, we will mainly change
// the tag to our customized search condition UI.

import * as React from 'react';

import {
  AbstractPureComponent2,
  Classes,
  DISPLAYNAME_PREFIX,
  IRef,
  Icon,
  IconSize,
  Keys,
  TagInputProps,
  Utils,
  refHandler,
  setRef,
} from '@blueprintjs/core';
import { AndQuery, QueryScopeMap } from '..';

import { AndQueryView } from './AndQueryView';
import { Query } from '../query';
import SearchInputClasses from './SearchInput.module.scss';
import classNames from 'classnames';
import { polyfill } from 'react-lifecycles-compat';

/**
 * The method in which a `TagInput` value was added.
 * - `"default"` - indicates that a value was added by manual selection.
 * - `"blur"` - indicates that a value was added when the `TagInput` lost focus.
 *   This is only possible when `addOnBlur=true`.
 * - `"paste"` - indicates that a value was added via paste. This is only
 *   possible when `addOnPaste=true`.
 */
export type SearchInputAddMethod = 'default' | 'blur' | 'paste';

export type SearchInputProps = Omit<TagInputProps, 'values' | 'onChange'> & {
  query: Query;
  scopeMap: QueryScopeMap;
  onChangeQuery: (newQuery: Query) => void;
};

export interface ISearchInputState {
  activeIndex: number;
  inputValue: string;
  isInputFocused: boolean;
  prevInputValueProp?: string;
}

/** special value for absence of active tag */
const NONE = -1;

class SearchInputImpl extends AbstractPureComponent2<
  SearchInputProps,
  ISearchInputState
> {
  public static displayName = `${DISPLAYNAME_PREFIX}.TagInput`;

  public static defaultProps: Partial<SearchInputProps> = {
    addOnBlur: false,
    addOnPaste: true,
    inputProps: {},
    separator: /[,\n\r]/,
    tagProps: {},
  };

  public static getDerivedStateFromProps(
    props: Readonly<SearchInputProps>,
    state: Readonly<ISearchInputState>,
  ): Partial<ISearchInputState> | null {
    if (props.inputValue !== state.prevInputValueProp) {
      return {
        inputValue: props.inputValue,
        prevInputValueProp: props.inputValue,
      };
    }
    return null;
  }

  public state: ISearchInputState = {
    activeIndex: NONE,
    inputValue: this.props.inputValue || '',
    isInputFocused: false,
  };

  public inputElement: HTMLInputElement | null = null;

  private handleRef: IRef<HTMLInputElement> = refHandler(
    this,
    'inputElement',
    this.props.inputRef,
  );

  public render() {
    const {
      query,
      scopeMap,
      className,
      disabled,
      fill,
      inputProps,
      intent,
      large,
      leftIcon,
      placeholder,
    } = this.props;

    const classes = classNames(
      Classes.INPUT,
      Classes.TAG_INPUT,
      {
        [Classes.ACTIVE]: this.state.isInputFocused,
        [Classes.DISABLED]: disabled,
        [Classes.FILL]: fill,
        [Classes.LARGE]: large,
      },
      Classes.intentClass(intent),
      className,
    );
    const isLarge = classes.indexOf(Classes.LARGE) > NONE;

    // use placeholder prop only if it's defined and values list is empty or contains only falsy values
    const isSomeValueDefined = query && !query.isEmpty();
    const resolvedPlaceholder =
      placeholder == null || isSomeValueDefined
        ? inputProps?.placeholder
        : placeholder;

    console.log('will render query:', this.props.query);

    return (
      <div className={SearchInputClasses.searchInputContainer}>
        <div
          className={classes}
          onBlur={this.handleContainerBlur}
          onClick={this.handleContainerClick}
        >
          <Icon
            className={Classes.TAG_INPUT_ICON}
            icon={leftIcon}
            size={isLarge ? IconSize.LARGE : IconSize.STANDARD}
          />
          <div className={Classes.TAG_INPUT_VALUES}>
            {this.props.query &&
              this.props.query.andQueries.map(this.maybeRenderAndQuery)}
            {this.props.children}
            <input
              value={this.state.inputValue}
              {...inputProps}
              onFocus={this.handleInputFocus}
              onChange={this.handleInputChange}
              onKeyDown={this.handleInputKeyDown}
              onKeyUp={this.handleInputKeyUp}
              onPaste={this.handleInputPaste}
              placeholder={resolvedPlaceholder}
              ref={this.handleRef}
              className={classNames(Classes.INPUT_GHOST, inputProps?.className)}
              disabled={disabled}
            />
          </div>
          {this.props.rightElement}
        </div>
      </div>
    );
  }

  public componentDidUpdate(prevProps: SearchInputProps) {
    if (prevProps.inputRef !== this.props.inputRef) {
      setRef(prevProps.inputRef, null);
      this.handleRef = refHandler(this, 'inputElement', this.props.inputRef);
      setRef(this.props.inputRef, this.inputElement);
    }
  }

  private addTags = (
    value: string,
    method: SearchInputAddMethod = 'default',
  ) => {
    const { inputValue, onAdd } = this.props;
    const newValues = this.getValues(value);
    const shouldClearInput =
      onAdd?.(newValues, method) !== false && inputValue === undefined;
    if (shouldClearInput) {
      this.setState({ inputValue: '' });
    }
  };

  private maybeRenderAndQuery = (andQuery: AndQuery, index: number) => {
    if (!andQuery) {
      return null;
    }
    if (!andQuery.terms || andQuery.terms.length <= 0) {
      return null;
    }
    const { large, tagProps } = this.props;
    const props = Utils.isFunction(tagProps)
      ? tagProps(andQuery, index)
      : tagProps;
    return (
      <AndQueryView
        andQuery={andQuery}
        scopeMap={this.props.scopeMap}
        onChangeAndQuery={(newAndQuery: AndQuery) => {
          this.props.onChangeQuery(
            this.props.query.replaceAndQuery(index, newAndQuery),
          );
        }}
        onFocusBackToInput={this.handleContainerClick}
        active={index === this.state.activeIndex}
        data-tag-index={index}
        key={index}
        large={large}
        onRemove={this.props.disabled ? undefined : this.handleRemoveTag}
        {...props}
      ></AndQueryView>
    );
  };

  private getNextActiveIndex(direction: number) {
    const { activeIndex } = this.state;
    if (activeIndex === NONE) {
      // nothing active & moving left: select last defined value. otherwise select nothing.
      return direction < 0
        ? this.findNextIndex(this.props.query.andQueries.length, -1)
        : NONE;
    } else {
      // otherwise, move in direction and clamp to bounds.
      // note that upper bound allows going one beyond last item
      // so focus can move off the right end, into the text input.
      return this.findNextIndex(activeIndex, direction);
    }
  }

  private findNextIndex(startIndex: number, direction: number) {
    const { query } = this.props;
    let index = startIndex + direction;
    while (index > 0 && index < query.andQueries.length && !query[index]) {
      index += direction;
    }
    return Utils.clamp(index, 0, query.andQueries.length);
  }

  /**
   * Splits inputValue on separator prop,
   * trims whitespace from each new value,
   * and ignores empty values.
   */
  private getValues(inputValue: string) {
    const { separator } = this.props;
    // NOTE: split() typings define two overrides for string and RegExp. this
    // does not play well with our union prop type, so we'll just declare it as
    // a valid type.
    return (
      separator === false ? [inputValue] : inputValue.split(separator as string)
    )
      .map((val) => val.trim())
      .filter((val) => val.length > 0);
  }

  private handleContainerClick = () => {
    this.inputElement?.focus();
  };

  private handleContainerBlur = ({
    currentTarget,
  }: React.FocusEvent<HTMLDivElement>) => {
    this.requestAnimationFrame(() => {
      // we only care if the blur event is leaving the container.
      // defer this check using rAF so activeElement will have updated.
      if (!currentTarget.contains(document.activeElement)) {
        if (
          this.props.addOnBlur &&
          this.state.inputValue !== undefined &&
          this.state.inputValue.length > 0
        ) {
          this.addTags(this.state.inputValue, 'blur');
        }
        this.setState({ activeIndex: NONE, isInputFocused: false });
      }
    });
  };

  private handleInputFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    this.setState({ isInputFocused: true });
    this.props.inputProps?.onFocus?.(event);
  };

  private handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ activeIndex: NONE, inputValue: event.currentTarget.value });
    this.props.onInputChange?.(event);
    this.props.inputProps?.onChange?.(event);
  };

  private handleInputKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    const { selectionEnd, value } = event.currentTarget;
    const { activeIndex } = this.state;

    let activeIndexToEmit = activeIndex;

    if (event.which === Keys.ENTER && value.length > 0) {
      this.addTags(value, 'default');
    } else if (selectionEnd === 0 && this.props.query.addAndQuery.length > 0) {
      // cursor at beginning of input allows interaction with tags.
      // use selectionEnd to verify cursor position and no text selection.
      if (event.which === Keys.ARROW_LEFT || event.which === Keys.ARROW_RIGHT) {
        const nextActiveIndex = this.getNextActiveIndex(
          event.which === Keys.ARROW_RIGHT ? 1 : -1,
        );
        if (nextActiveIndex !== activeIndex) {
          event.stopPropagation();
          activeIndexToEmit = nextActiveIndex;
          this.setState({ activeIndex: nextActiveIndex });
        }
      } else if (event.which === Keys.BACKSPACE) {
        this.handleBackspaceToRemove(event);
      } else if (event.which === Keys.DELETE) {
        this.handleDeleteToRemove(event);
      }
    }

    this.invokeKeyPressCallback('onKeyDown', event, activeIndexToEmit);
  };

  private handleInputKeyUp = (event: React.KeyboardEvent<HTMLInputElement>) => {
    this.invokeKeyPressCallback('onKeyUp', event, this.state.activeIndex);
  };

  private handleInputPaste = (
    event: React.ClipboardEvent<HTMLInputElement>,
  ) => {
    const { separator } = this.props;
    const value = event.clipboardData.getData('text');

    if (!this.props.addOnPaste || value.length === 0) {
      return;
    }

    // special case as a UX nicety: if the user pasted only one value with no
    // delimiters in it, leave that value in the input field so that the user
    // can refine it before converting it to a tag manually.
    if (separator === false || value.split(separator!).length === 1) {
      return;
    }

    event.preventDefault();
    this.addTags(value, 'paste');
  };

  private handleRemoveTag = (event: React.MouseEvent<HTMLSpanElement>) => {
    // using data attribute to simplify callback logic -- one handler for all
    // children
    const index =
      +event.currentTarget.parentElement!.getAttribute('data-tag-index')!;
    this.removeIndexFromValues(index);
  };

  private handleBackspaceToRemove(
    event: React.KeyboardEvent<HTMLInputElement>,
  ) {
    const previousActiveIndex = this.state.activeIndex;
    // always move leftward one item (this will focus last item if nothing is
    // focused)
    this.setState({ activeIndex: this.getNextActiveIndex(-1) });
    // delete item if there was a previous valid selection (ignore first
    // backspace to focus last item)
    if (this.isValidIndex(previousActiveIndex)) {
      event.stopPropagation();
      this.removeIndexFromValues(previousActiveIndex);
    }
  }

  private handleDeleteToRemove(event: React.KeyboardEvent<HTMLInputElement>) {
    const { activeIndex } = this.state;
    if (this.isValidIndex(activeIndex)) {
      event.stopPropagation();
      this.removeIndexFromValues(activeIndex);
    }
  }

  /** Remove the item at the given index by invoking `onRemove` and `onChange`
   * accordingly. */
  private removeIndexFromValues(index: number) {
    const { onRemove, query } = this.props;
    onRemove?.(query.andQueries[index], index);
  }

  private invokeKeyPressCallback(
    propCallbackName: 'onKeyDown' | 'onKeyUp',
    event: React.KeyboardEvent<HTMLInputElement>,
    activeIndex: number,
  ) {
    this.props[propCallbackName]?.(
      event,
      activeIndex === NONE ? undefined : activeIndex,
    );
    this.props.inputProps![propCallbackName]?.(event);
  }

  /** Returns whether the given index represents a valid item in
   * `this.props.values`. */
  private isValidIndex(index: number) {
    return index !== NONE && index < this.props.query.andQueries.length;
  }
}

export const SearchInput = polyfill(SearchInputImpl);
