import React, { useEffect } from 'react';

export const PageTitle = (props) => {
  useEffect(() => {
    window.document.title = props.title;
  }, []);
  return <></>;
};
