import React from 'react';

export interface ICollapsibleLabelProps {
  text: string;
  maxLength?: number;
}

export const CollapsibleLabel = (props: ICollapsibleLabelProps) => {
  let textStr = props.text;
  if (textStr) {
    const maxlength = props.maxLength || 70;
    if (textStr.length > maxlength) {
      textStr = `${textStr.substr(0, maxlength)}...`;
    }
  } else {
    textStr = '';
  }
  return <span title={props.text}>{textStr}</span>;
};
