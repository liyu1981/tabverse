/**
 * The page actions on a live tab: copy its content as Markdown, hand that
 * Markdown to the AI chat, or summarize it into a note.
 *
 * This is the old summarize button, widened. The Markdown conversion
 * (`data/tabSpace/pageMarkdown.ts`) is now the common first step - it is what
 * makes the summary cleaner (Readability drops the page chrome the old
 * `innerText` read kept) and it is the thing the copy and chat actions want -
 * so the menu names four outcomes instead of two.
 *
 * The button is always drawn on a live tab, because **copy needs no AI**: the
 * AI items are the ones disabled when the browser has no built-in model or the
 * person switched it off. It is disabled while the tab is suspended, since a
 * discarded tab has no page to read.
 *
 * The shape follows `SuggestNameButton`: a presentational view that can be
 * checked by what it renders, and a container that owns the availability
 * subscription, the run, and the failure line.
 */
import { t } from '../../../i18n';
import { Button, Menu, MenuItem, Popover } from '@blueprintjs/core';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useStore } from 'effector-react';

import {
  getAiAvailability,
  probeAiAvailability,
  subscribeAiAvailability,
} from '../../../ai/availability';
import {
  getAiEnabled,
  loadAiEnabled,
  subscribeAiEnabled,
} from '../../../ai/aiSettings';
import {
  SUMMARIZE_SYSTEM_PROMPT,
  summarizeTab,
  summaryNoteBody,
  summaryNoteName,
} from '../../../ai/summarize';
import { ensureAiSession, evictAiSession } from '../../../ai/session';
import { setChatContext } from '../../../data/aiChat/store';
import { addNoteToTabSpace, newSummaryNote } from '../../../data/note/util';
import { markdownToPlainText } from '../../../data/note/markdownText';
import { convertTabToMarkdown } from '../../../data/tabSpace/pageMarkdown';
import { extractTabText } from '../../../data/tabSpace/tabText';
import { ToolTabMsg, sendPubSubMessage } from '../../../message/message';
import { $selectedNoteId, getNoteEditor } from '../../notebook/selectedNote';
import type { Tab } from '../../../data/tabSpace/Tab';
import { logger } from '../../../global';
import { MarkdownViewDialog } from './MarkdownViewDialog';
import classes from './TabContentButton.module.scss';

/** The line under the button when nothing has happened yet. */
const READY_STATUS = 'pcbReadyStatus';

/** Why the button is disabled: a suspended tab has no page to read. */
const SUSPENDED_STATUS = 'pcbSuspendedStatus';

/** The failures the Markdown step can report. */
const UNREADABLE_STATUS = 'pcbUnreadableStatus';

/** What one menu item does. */
export type TabContentMode = 'view' | 'chat' | 'summary-new' | 'summary-append';

export interface TabContentMenuProps {
  /** False when no note editor is active, so "append" has nowhere to go. */
  canAppend: boolean;
  /** True when the AI items must be disabled (no model, or switched off). */
  aiDisabled: boolean;
  onSelect: (mode: TabContentMode) => void;
}

/** The four outcomes, presentational so they can be checked statically. */
export function TabContentMenu(props: TabContentMenuProps) {
  return (
    <Menu>
      <MenuItem
        icon="eye-open"
        text={t('pcbViewMarkdown')}
        onClick={() => props.onSelect('view')}
      />
      <MenuItem
        icon="comment"
        text={t('pcbSendToChat')}
        disabled={props.aiDisabled}
        onClick={() => props.onSelect('chat')}
      />
      <MenuItem
        icon="document"
        text={t('pcbNewNote')}
        disabled={props.aiDisabled}
        onClick={() => props.onSelect('summary-new')}
      />
      <MenuItem
        icon="insert"
        text={t('pcbAppendNote')}
        disabled={props.aiDisabled || !props.canAppend}
        onClick={() => props.onSelect('summary-append')}
      />
    </Menu>
  );
}

export interface TabContentButtonViewProps {
  busy: boolean;
  /** The tooltip line: the offer, a progress note, or why it failed. */
  status: string;
  /** True while the tab is suspended and has no page to read. */
  disabled?: boolean;
  canAppend: boolean;
  /** True when the AI items must be disabled (no model, or switched off). */
  aiDisabled: boolean;
  onSelect: (mode: TabContentMode) => void;
}

/** The button and its menu, presentational so its states can be checked. */
export function TabContentButtonView(props: TabContentButtonViewProps) {
  return (
    <Popover
      content={
        <TabContentMenu
          aiDisabled={props.aiDisabled}
          canAppend={props.canAppend}
          onSelect={props.onSelect}
        />
      }
      placement="bottom-end"
      interactionKind="click"
      disabled={props.disabled}
      portalClassName={classes.portal}
    >
      <Button
        className="tv-icon-button"
        aria-label={t('pcbAria')}
        title={props.status}
        icon="lightbulb"
        minimal={true}
        loading={props.busy}
        disabled={props.disabled}
      />
    </Popover>
  );
}

export interface TabContentButtonProps {
  tab: Tab;
  tabSpaceId: string;
}

export function TabContentButton(props: TabContentButtonProps) {
  const { tab, tabSpaceId } = props;
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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // The page's Markdown while the view dialog is open, null when it is closed.
  const [preview, setPreview] = useState<{ markdown: string } | null>(null);
  // A selection, not a focus: the note stays selected while the person clicks
  // here, so "append to current note" has a target.
  const selectedNoteId = useStore($selectedNoteId);
  const runningRef = useRef(false);

  useEffect(() => {
    void loadAiEnabled();
    void probeAiAvailability();
  }, []);

  // The same condition the old button used to hide itself: a built-in model, and
  // the setting on. `checking` is the mount probe still in flight; `error` is
  // retryable, so it does not disable the items.
  const aiDisabled =
    enabled !== true ||
    availability.state === 'checking' ||
    availability.state === 'absent';

  /** The read-and-convert step every outcome shares. */
  const readAsMarkdown = useCallback(async () => {
    const article = await convertTabToMarkdown(tab.chromeTabId);
    return article?.markdown ?? '';
  }, [tab.chromeTabId]);

  /** The summary step: Markdown first, then the model, then a note. */
  const summarize = useCallback(
    async (mode: 'summary-new' | 'summary-append') => {
      const markdown = await readAsMarkdown();
      // The plain text of the isolated article, so the prompt stays prose; a
      // page Readability could not parse still gets the old flat read.
      let text = markdown ? markdownToPlainText(markdown) : '';
      if (!text.trim()) {
        text = (await extractTabText(tab.chromeTabId)) ?? '';
      }
      if (!text.trim()) {
        setStatus(t('pcbCannotRead'));
        return;
      }
      const session = await ensureAiSession(SUMMARIZE_SYSTEM_PROMPT);
      const summary = await summarizeTab(session, text);
      if (!summary.trim()) {
        setStatus(t('pcbNoSummary'));
        return;
      }
      const body = summaryNoteBody(tab.title, tab.url, summary);
      if (mode === 'summary-append') {
        const target = getNoteEditor(selectedNoteId);
        if (target === null) {
          setStatus(t('pcbNoNoteSelected'));
          return;
        }
        const existing = target.getContent();
        // Propose, do not write: the review dialog is where this is decided.
        target.setContent(existing.trim() ? `${existing}\n\n${body}` : body);
        return;
      }
      await addNoteToTabSpace(
        tabSpaceId,
        newSummaryNote(summaryNoteName(tab.title), body),
      );
      setStatus(t('pcbNoteAdded'));
    },
    [
      readAsMarkdown,
      selectedNoteId,
      tab.chromeTabId,
      tab.title,
      tab.url,
      tabSpaceId,
    ],
  );

  const run = useCallback(
    async (mode: TabContentMode) => {
      if (runningRef.current || tab.suspended) {
        return;
      }
      runningRef.current = true;
      setBusy(true);
      setStatus(null);
      try {
        if (mode === 'view') {
          const markdown = await readAsMarkdown();
          if (!markdown) {
            setStatus(t(UNREADABLE_STATUS));
            return;
          }
          setPreview({ markdown });
          return;
        }
        if (mode === 'chat') {
          const markdown = await readAsMarkdown();
          if (!markdown) {
            setStatus(t(UNREADABLE_STATUS));
            return;
          }
          // Attach the page as the question's context, not as the composer's
          // text: the chat opens with a chip and the person types their own
          // question. `sendChat` puts the page and the question together.
          setChatContext({
            title: tab.title,
            url: tab.url,
            markdown,
          });
          sendPubSubMessage(ToolTabMsg.OpenChat, true);
          setStatus(t('pcbAttached'));
          return;
        }
        let current = getAiAvailability();
        // `checking` is the mount probe still in flight; `error` is the one
        // state a probe does not cache - both mean "ask again"
        if (current.state === 'checking' || current.state === 'error') {
          current = await probeAiAvailability();
        }
        if (current.state === 'absent') {
          setStatus(t('suggestNoAiBrowser'));
          return;
        }
        await summarize(mode);
      } catch (err) {
        logger.log('tab page action failed', err);
        // the session is not worth keeping after a failed prompt
        evictAiSession(SUMMARIZE_SYSTEM_PROMPT);
        setStatus(
          getAiAvailability().state === 'absent'
            ? t('suggestNoAiBrowser')
            : t('suggestCannotReach'),
        );
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [readAsMarkdown, summarize, tab.suspended, tab.title, tab.url],
  );

  const suspended = tab.suspended === true;
  return (
    <>
      <TabContentButtonView
        busy={busy}
        disabled={suspended}
        canAppend={getNoteEditor(selectedNoteId) !== null}
        aiDisabled={aiDisabled}
        status={suspended ? t(SUSPENDED_STATUS) : (status ?? t(READY_STATUS))}
        onSelect={(mode) => void run(mode)}
      />
      {preview ? (
        <MarkdownViewDialog
          title={tab.title}
          markdown={preview.markdown}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}
