import { t } from '../../i18n';
import { Button, Menu, MenuItem, Popover, TextArea } from '@blueprintjs/core';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  getAiAvailability,
  probeAiAvailability,
  subscribeAiAvailability,
} from '../../ai/availability';
import {
  getAiEnabled,
  loadAiEnabled,
  subscribeAiEnabled,
} from '../../ai/aiSettings';
import {
  DEFAULT_NOTE_INSTRUCTION,
  NOTE_REWRITE_SYSTEM_PROMPT,
  rewriteNote,
} from '../../ai/rewriteNote';
import { ensureAiSession, evictAiSession } from '../../ai/session';
import { setChatContext } from '../../data/aiChat/store';
import { ToolTabMsg, sendPubSubMessage } from '../../message/message';
import { logger } from '../../global';
import classes from './ReviseNoteButton.module.scss';

/**
 * The note's "revise with AI" action.
 *
 * A small dropdown off the note's tools row, hidden when the browser has no
 * built-in AI or the person switched it off; the first Rewrite is the download
 * consent. The note's own words are the content being edited, and the person
 * says what to do with them.
 *
 * The result is not written - it is proposed through the editor's `setContent`,
 * so the person sees the diff and decides (adr/0031).
 */

export interface ReviseNoteButtonProps {
  /** The note body as markdown, read when Rewrite is pressed. */
  getContent: () => string;
  /** Hand the revision to the editor, which reviews it before applying. */
  proposeContent: (markdown: string) => void;
  /** The note's name, used when attaching it to the AI chat. */
  noteTitle?: string;
}

export function ReviseNoteButton(props: ReviseNoteButtonProps) {
  const { getContent, proposeContent, noteTitle } = props;
  const availability = useSyncExternalStore(
    subscribeAiAvailability,
    getAiAvailability,
    getAiAvailability,
  );
  const enabled = useSyncExternalStore(
    subscribeAiEnabled,
    getAiEnabled,
    getAiEnabled,
  );
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'menu' | 'revise'>('menu');
  const [instruction, setInstruction] = useState(DEFAULT_NOTE_INSTRUCTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    void loadAiEnabled();
    void probeAiAvailability();
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current || !instruction.trim()) {
      return;
    }
    runningRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let current = getAiAvailability();
      if (current.state === 'checking' || current.state === 'error') {
        current = await probeAiAvailability();
      }
      if (current.state === 'absent') {
        setError(t('suggestNoAiBrowser'));
        return;
      }
      const note = getContent();
      const session = await ensureAiSession(NOTE_REWRITE_SYSTEM_PROMPT);
      const revised = await rewriteNote(session, instruction, note);
      if (!revised.trim()) {
        setError(t('reviseNoRevision'));
        return;
      }
      setOpen(false);
      proposeContent(revised);
    } catch (err) {
      logger.log('revise note failed', err);
      // the session is not worth keeping after a failed prompt
      evictAiSession(NOTE_REWRITE_SYSTEM_PROMPT);
      setError(
        getAiAvailability().state === 'absent'
          ? t('suggestNoAiBrowser')
          : t('suggestCannotReach'),
      );
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [instruction, getContent, proposeContent]);

  if (
    enabled !== true ||
    availability.state === 'checking' ||
    availability.state === 'absent'
  ) {
    return null;
  }

  return (
    <Popover
      isOpen={open}
      onInteraction={(next) => {
        if (busy) {
          return;
        }
        if (next) {
          // a fresh default each time the dropdown opens
          setError(null);
          setInstruction(DEFAULT_NOTE_INSTRUCTION);
          setStep('menu');
        }
        setOpen(next);
      }}
      interactionKind="click"
      placement="bottom-end"
      autoFocus={true}
      portalClassName={classes.portal}
      content={
        step === 'menu' ? (
          <Menu>
            <MenuItem
              icon="lightbulb"
              text="Revise with AI"
              onClick={() => setStep('revise')}
            />
            <MenuItem
              icon="comment"
              text="Add to AI chat"
              onClick={() => {
                setOpen(false);
                setChatContext({
                  title: noteTitle ?? 'Note',
                  markdown: getContent(),
                });
                sendPubSubMessage(ToolTabMsg.OpenChat, true);
              }}
            />
          </Menu>
        ) : (
          <div className={classes.panel}>
            <p className="muted small">{t('reviseSayHint')}</p>
            <TextArea
              fill={true}
              rows={3}
              value={instruction}
              onChange={(event) => setInstruction(event.currentTarget.value)}
              aria-label={t('reviseInstructionAria')}
            />
            {error ? <p className="danger-text">{error}</p> : null}
            <div className={classes.actions}>
              <Button
                small={true}
                onClick={() => setStep('menu')}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                small={true}
                intent="primary"
                loading={busy}
                disabled={!instruction.trim()}
                onClick={() => void run()}
              >
                Do It
              </Button>
            </div>
          </div>
        )
      }
    >
      <Button
        icon="lightbulb"
        minimal={true}
        aria-label={t('reviseAria')}
        title={t('reviseTitle')}
      />
    </Popover>
  );
}
