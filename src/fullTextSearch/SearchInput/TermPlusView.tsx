import { Classes, Intent, Keys, Tag } from '@blueprintjs/core';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import classes from './TermPlusView.module.scss';
import clsx from 'clsx';

export interface TermPlusViewProps {
  onFocusBackToInput: () => void;
  onAddTerms: (terms: string[]) => void;
}

export function TermPlusView(props: TermPlusViewProps) {
  const [activated, setActivated] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>();

  const onInputKeyDown = useMemo(
    () => (event: React.KeyboardEvent<HTMLInputElement>) => {
      const { value } = event.currentTarget;
      if (event.which === Keys.ENTER && value.length > 0) {
        const terms = value.trim().split(/[,\n\r]/);
        props.onAddTerms(terms);
        props.onFocusBackToInput();
        setActivated(false);
      } else if (event.which === Keys.ESCAPE) {
        setActivated(false);
        props.onFocusBackToInput();
      }
    },
    [],
  );

  const onInputBlur = useMemo(
    () => () => {
      setActivated(false);
      props.onFocusBackToInput();
    },
    [],
  );

  useEffect(() => {
    if (activated && inputRef && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activated]);

  return (
    <span className={classes.termPlusContainer}>
      {activated ? (
        <input
          ref={inputRef}
          className={clsx(Classes.INPUT, Classes.ROUND, classes.termPlusInput)}
          onKeyDown={onInputKeyDown}
          onBlur={onInputBlur}
          type="text"
        ></input>
      ) : (
        <Tag
          intent={Intent.SUCCESS}
          large={false}
          round={true}
          onClick={(event) => {
            setActivated(true);
            event.stopPropagation();
          }}
        >
          +
        </Tag>
      )}
    </span>
  );
}
