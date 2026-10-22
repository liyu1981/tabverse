/**
 * The "view the page as Markdown" dialog: the converted Markdown, and a button
 * to copy it.
 *
 * It shows the Markdown **source**, not the rendered document: the point of the
 * action is to see and take what the conversion produced. The body is a
 * separate component from the `Dialog` around it, because Blueprint renders the
 * dialog through a portal and a portal shows nothing under
 * `renderToStaticMarkup` (the same note `NoteReviewDialog` carries) - so this
 * way the Markdown and the copy state are still checkable by what they render.
 */
import { t } from '../../../i18n';
import { Button, Dialog, DialogBody } from '@blueprintjs/core';
import React, { useCallback, useState } from 'react';

import classes from './MarkdownViewDialog.module.scss';

export interface MarkdownViewBodyProps {
  /** The page's title, drawn beside the copy button. */
  title: string;
  /** The converted Markdown, shown verbatim. */
  markdown: string;
  /** True for a moment after a copy, so the button can say so. */
  copied: boolean;
  onCopy: () => void;
}

/** The dialog's contents, without the portal around them. */
export function MarkdownViewBody(props: MarkdownViewBodyProps) {
  return (
    <DialogBody className={classes.body}>
      <div className={classes.header}>
        <span className={classes.title} title={props.title}>
          {props.title}
        </span>
        <Button
          className="tv-primary-button"
          icon={props.copied ? 'tick' : 'duplicate'}
          text={props.copied ? t('markdownCopied') : t('markdownCopy')}
          onClick={props.onCopy}
        />
      </div>
      <pre className={classes.markdown}>{props.markdown}</pre>
    </DialogBody>
  );
}

export interface MarkdownViewDialogProps {
  title: string;
  markdown: string;
  onClose: () => void;
}

export function MarkdownViewDialog(props: MarkdownViewDialogProps) {
  const { title, markdown, onClose } = props;
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    // the raw Markdown: what a Markdown-aware target wants
    void navigator.clipboard?.writeText(markdown).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [markdown]);

  return (
    <Dialog
      className={classes.dialog}
      isOpen={true}
      onClose={onClose}
      icon="document"
      title={t('markdownDialogTitle')}
    >
      <MarkdownViewBody
        title={title}
        markdown={markdown}
        copied={copied}
        onCopy={copy}
      />
    </Dialog>
  );
}
