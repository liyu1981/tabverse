import { EditableTag } from './EditableTag';
import { Intent } from '@blueprintjs/core';
import React from 'react';

export interface TermsViewProps {
  values: string[];
  onRemoveTerm: (index: number) => void;
}

export function TermsView({ values, onRemoveTerm }: TermsViewProps) {
  return (
    <span>
      {values.map((value, index) => {
        return (
          <EditableTag
            // the term itself is the stable identity here; keying on the
            // index made React reuse the wrong tag when one was removed
            key={value}
            large={false}
            round={true}
            intent={Intent.SUCCESS}
            onRemove={() => onRemoveTerm(index)}
          >
            {value}
          </EditableTag>
        );
      })}
    </span>
  );
}
