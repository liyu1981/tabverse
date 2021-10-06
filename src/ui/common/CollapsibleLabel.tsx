import * as React from 'react';

export interface ICollapsibleLabelProps {
  text: string;
  maxLength?: number;
}

export const CollapsibleLabel = (props: ICollapsibleLabelProps) => {
  let textstr = props.text;
  if (textstr) {
    const maxlength = props.maxLength || 70;
    if (textstr.length > maxlength) {
      textstr = `${textstr.substr(0, maxlength)}...`;
    }
  } else {
    textstr = '';
  }
  return <span title={props.text}>{textstr}</span>;
};
