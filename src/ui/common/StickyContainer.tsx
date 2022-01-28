import { Classes } from '@blueprintjs/core';
import * as React from 'react';

import { useEffect, useRef, useState } from 'react';

function shouldBeSticky(
  thresh: number,
  divRef: React.MutableRefObject<HTMLDivElement>,
  scrollToY: number,
): boolean {
  if (divRef.current) {
    return scrollToY > thresh;
  } else {
    return false;
  }
}

export interface StickyContainerProps {
  thresh: number;
  stickyOnClassName: string;
  children: React.ReactElement | React.ReactElement[] | string;
}

export const StickyContainer = (props: StickyContainerProps) => {
  const [scrollToY, setScrollToY] = useState(0);
  const divRef = useRef<HTMLDivElement>();

  const handleScroll = (event) => {
    console.log('scrolled');
    setScrollToY(window.scrollY);
  };

  useEffect(() => {
    console.log('reg handler', window);
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const stickyOn =
    divRef.current && shouldBeSticky(props.thresh, divRef, scrollToY);

  const divRefRect = divRef.current?.getBoundingClientRect() ?? {
    height: 0,
  };

  if (stickyOn) {
    console.log('stickon', divRefRect);
  }

  return (
    <div ref={divRef} className={stickyOn ? props.stickyOnClassName : ''}>
      {props.children}
      <div
        style={
          stickyOn ? { height: `${divRefRect.height}px` } : { height: '0px' }
        }
      ></div>
    </div>
  );
};
