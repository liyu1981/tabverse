import { Dialog } from '@blueprintjs/core';
import React from 'react';

export interface MoveToExistTabverseDialogProps {
  isOpen: boolean;
  onClose: any;
}

export function MoveToExistTabSpaceDialog(
  props: MoveToExistTabverseDialogProps,
) {
  return (
    <Dialog
      isOpen={props.isOpen}
      canOutsideClickClose={true}
      onClose={props.onClose}
    >
      Move to exist tabverse.
    </Dialog>
  );
}
