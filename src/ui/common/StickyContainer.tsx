import React, { useEffect, useRef, useState } from 'react';

import { debounce } from 'lodash';

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

  const handleScroll = debounce((event) => {
    setScrollToY(window.scrollY);
  });

  useEffect(() => {
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
