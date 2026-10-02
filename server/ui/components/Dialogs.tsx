import {
  Button,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
} from '@blueprintjs/core';
import React, { useState } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  intent?: 'primary' | 'danger';
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * The console's `window.confirm`, as a dialog.
 *
 * The browser's own dialog cannot be styled, cannot say which of three similar
 * questions is being asked, and disappears in a screenshot - and one of the
 * three (archiving a device) has a sentence of consequences in it that an
 * operator should be able to read twice.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await props.onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={props.onCancel}
      title={props.title}
      canOutsideClickClose={!busy}
      canEscapeKeyClose={!busy}
    >
      <DialogBody>
        <div className="dialog-text">{props.body}</div>
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button disabled={busy} onClick={props.onCancel}>
              Cancel
            </Button>
            <Button
              intent={props.intent || 'primary'}
              loading={busy}
              onClick={confirm}
            >
              {props.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

interface TypedConfirmDialogProps {
  isOpen: boolean;
  title: string;
  body: React.ReactNode;
  /** What has to be typed, and what the button says while it is not. */
  expected: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * The typed confirmation for the two destructive things there are: deleting an
 * account and deleting a tabverse. Both are irreversible from here, and both are
 * one mis-clicked button away from somebody else's data - so the operator types
 * the name, and the server is sent the id back as `?confirm=` on top of that
 * (adr/0015).
 */
export function TypedConfirmDialog(props: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed === props.expected;

  const close = () => {
    setTyped('');
    props.onCancel();
  };

  const confirm = async () => {
    if (!matches) return;
    setBusy(true);
    try {
      await props.onConfirm();
      setTyped('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={close}
      title={props.title}
      canOutsideClickClose={!busy}
      canEscapeKeyClose={!busy}
    >
      <DialogBody>
        <div className="dialog-text">{props.body}</div>
        <label className="dialog-label" htmlFor="typed-confirmation">
          Type <b>{props.expected}</b> to confirm
        </label>
        <input
          id="typed-confirmation"
          className={Classes.INPUT}
          value={typed}
          autoFocus={true}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setTyped(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches) void confirm();
          }}
        />
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button
              intent="danger"
              disabled={!matches}
              loading={busy}
              onClick={confirm}
            >
              {props.confirmLabel || 'Delete'}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}

interface PromptDialogProps {
  isOpen: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

/** The console's `window.prompt`, for the one place it is used: renaming an
 *  account. */
export function PromptDialog(props: PromptDialogProps) {
  const [value, setValue] = useState(props.initial || '');

  const close = () => props.onCancel();
  const confirm = async () => {
    await props.onConfirm(value.trim());
    setValue(props.initial || '');
  };

  return (
    <Dialog isOpen={props.isOpen} onClose={close} title={props.title}>
      <DialogBody>
        <label className="dialog-label" htmlFor="prompt-value">
          {props.label}
        </label>
        <input
          id="prompt-value"
          className={Classes.INPUT}
          value={value}
          autoFocus={true}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirm();
          }}
        />
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button intent="primary" onClick={confirm}>
              {props.confirmLabel || 'Save'}
            </Button>
          </>
        }
      />
    </Dialog>
  );
}
