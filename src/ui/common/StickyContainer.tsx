import * as React from 'react';

import { useEffect, useRef, useState } from 'react';

export interface StickyContainerProps {
  thresh: number;
  stickyStyle: React.CSSProperties;
  children: React.ReactElement | React.ReactElement[] | string;
}

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

export const StickyContainer = (props: StickyContainerProps) => {
  const [scrollToY, setScrollToY] = useState(0);
  const divRef = useRef<HTMLDivElement>();

  const handleScroll = (event) => {
    setScrollToY(window.scrollY);
  };

  useEffect(() => {
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div
      ref={divRef}
      style={
        divRef.current && shouldBeSticky(props.thresh, divRef, scrollToY)
          ? props.stickyStyle
          : {}
      }
    >
      {props.children}
    </div>
  );
};
