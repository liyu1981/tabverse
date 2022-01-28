import * as React from 'react';

import classes from './FavIcon.module.scss';
import clsx from 'clsx';

interface IFavIconProps {
  url: string;
  className?: string;
}

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      marginTop: '-10px',
      marginRight: '10px',
    },
    img: {
      maxWidth: '32px',
      minWidth: '32px',
      maxHeight: '32px',
      minHeight: '32px',
    },
  };
}

export const FavIcon = (props: IFavIconProps) => {
  return (
    <span className={clsx(classes.container, props.className ?? '')}>
      <img
        className={classes.img}
        src={
          props.url.length > 0
            ? props.url
            : 'https://dummyimage.com/32x32/bbbbbb/111111&text=Logo'
        }
      />
    </span>
  );
};
