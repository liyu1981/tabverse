import { Button } from '@blueprintjs/core';
import React, { useEffect, useRef, useState } from 'react';

import { copyText, selectText } from './clipboard';
import { pushToast } from '../data/stores/toasts';

interface CopyButtonProps {
  text: string;
  label?: string;
}

/**
 * A button that copies `text` and says so. When the copy is refused it selects
 * the text instead and tells the operator to press Ctrl+C, which is the only
 * thing left that works over plain http.
 */
export function CopyButton(props: CopyButtonProps) {
  const [done, setDone] = useState(false);
  const [node, setNode] = useState<HTMLSpanElement | null>(null);
  const restoring = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (restoring.current) window.clearTimeout(restoring.current);
    },
    [],
  );

  const label = props.label || 'Copy';

  const onClick = async () => {
    if (await copyText(props.text)) {
      setDone(true);
      if (restoring.current) window.clearTimeout(restoring.current);
      restoring.current = window.setTimeout(() => setDone(false), 1600);
      return;
    }
    selectText(node);
    pushToast({
      message: 'Copying was blocked — the text is selected, press Ctrl+C',
      kind: 'bad',
    });
  };

  return (
    <>
      <span ref={setNode} className="mono">
        {props.text}
      </span>
      <Button
        small={true}
        minimal={true}
        intent={done ? 'success' : 'none'}
        onClick={onClick}
      >
        {done ? 'Copied' : label}
      </Button>
    </>
  );
}
