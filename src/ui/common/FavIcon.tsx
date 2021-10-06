import * as React from 'react';

import { merge } from 'lodash';

interface IFavIconProps {
  url: string;
  containerStyle?: React.CSSProperties;
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
  const styles = createStyles();
  return (
    <span style={merge(styles.container, props.containerStyle)}>
      <img
        style={styles.img}
        src={
          props.url.length > 0
            ? props.url
            : 'https://dummyimage.com/32x32/bbbbbb/111111&text=Logo'
        }
      />
    </span>
  );
};
