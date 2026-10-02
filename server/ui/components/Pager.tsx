import { Button, ButtonGroup } from '@blueprintjs/core';
import React from 'react';

import { pageLabel } from '../data/stores/browse';

interface PagerProps {
  total: number;
  offset: number;
  limit: number;
  onPage: (offset: number) => void;
}

/** "1–24 of 60" with a step either way, and nothing enabled at the ends. */
export function Pager(props: PagerProps) {
  const { total, offset, limit, onPage } = props;
  if (total <= limit && offset === 0) return null;
  return (
    <div className="pager">
      <Button
        minimal={true}
        small={true}
        disabled={offset <= 0}
        onClick={() => onPage(Math.max(0, offset - limit))}
      >
        ← Newer
      </Button>
      <span>{pageLabel(total, offset, limit)}</span>
      <Button
        minimal={true}
        small={true}
        disabled={offset + limit >= total}
        onClick={() => onPage(offset + limit)}
      >
        Older →
      </Button>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
}

/** The pill segmented control: a grey well with a white pill for the current
 *  one, which is what the extension's tag inputs do. */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  return (
    <ButtonGroup className="segmented" aria-label={props.ariaLabel}>
      {props.options.map((option) => (
        <Button
          key={option.value}
          active={props.value === option.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </ButtonGroup>
  );
}
