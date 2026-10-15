/**
 * The summarize action on a live tab: read the page, summarize it with the
 * on-device model, and put the result into a note of this tabverse - a new
 * note, or appended to the note being edited (reviewed before it is applied,
 * adr/0031).
 *
 * The button opens a menu rather than acting on one click: replacing the note
 * somebody is writing is not something to do by accident, so the two outcomes
 * are named and chosen.
 *
 * The shape follows `SuggestNameButton` - a presentational view that can be
 * checked by what it renders, and a container that owns the availability
 * subscription, the run, and the failure line. The rules it keeps:
 *
 * - **Hidden when absent or off** (plan D3/D10): while the browser has no
 *   built-in AI, or the person switched it off in Settings, the tab shows no
 *   button at all rather than one that does nothing.
 * - **The first action is the download consent** (plan D4): nothing runs at
 *   page load; the model downloads inside `session.ts` when a menu item is
 *   chosen.
 *
 * Reading the page needs `chrome.scripting` (see `data/tabSpace/tabText.ts`),
 * which is why this is the feature that adds that permission.
 */
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
import { addNoteToTabSpace, newSummaryNote } from '../../../data/note/util';
import { $selectedNoteId, getNoteEditor } from '../../notebook/selectedNote';
import type { Tab } from '../../../data/tabSpace/Tab';
import { extractTabText } from '../../../data/tabSpace/tabText';
import { logger } from '../../../global';
import classes from './SummarizeTabButton.module.scss';

/** The line under the button when nothing has happened yet. */
const SUMMARIZE_READY_STATUS = 'Summarize this tab with AI';

/** Why the button is disabled: a suspended tab has no page to read. */
const SUMMARIZE_SUSPENDED_STATUS =
  'This tab is suspended - open it to load it, then summarize it';

/** Where the summary goes: a new note, or the note being edited. */
export type SummarizeMode = 'new' | 'append';

export interface SummarizeTabMenuProps {
  /** False when no note editor is active, so "append" has nowhere to go. */
  canAppend: boolean;
  onSelect: (mode: SummarizeMode) => void;
}

/** The two outcomes, presentational so they can be checked statically. */
export function SummarizeTabMenu(props: SummarizeTabMenuProps) {
  return (
    <Menu>
      <MenuItem
        icon="document"
        text="New note with AI summary"
        onClick={() => props.onSelect('new')}
      />
      <MenuItem
        icon="insert"
        text="Append to current note"
        disabled={!props.canAppend}
        onClick={() => props.onSelect('append')}
      />
    </Menu>
  );
}

export interface SummarizeTabButtonViewProps {
  busy: boolean;
  /** The tooltip line: the offer, a progress note, or why it failed. */
  status: string;
  /** True while the tab is suspended and has no page to read. */
  disabled?: boolean;
  canAppend: boolean;
  onSelect: (mode: SummarizeMode) => void;
}

/** The button and its menu, presentational so its states can be checked. */
export function SummarizeTabButtonView(props: SummarizeTabButtonViewProps) {
  return (
    <Popover
      content={
        <SummarizeTabMenu
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
        aria-label="Summarize this tab with AI"
        title={props.status}
        icon="lightbulb"
        minimal={true}
        loading={props.busy}
        disabled={props.disabled}
      />
    </Popover>
  );
}

export interface SummarizeTabButtonProps {
  tab: Tab;
  tabSpaceId: string;
}

export function SummarizeTabButton(props: SummarizeTabButtonProps) {
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
  // A selection, not a focus: the note stays selected while the person clicks
  // here, so "append to current note" has a target.
  const selectedNoteId = useStore($selectedNoteId);
  const runningRef = useRef(false);

  useEffect(() => {
    void loadAiEnabled();
    void probeAiAvailability();
  }, []);

  const run = useCallback(
    async (mode: SummarizeMode) => {
      if (runningRef.current || tab.suspended) {
        return;
      }
      runningRef.current = true;
      setBusy(true);
      setStatus(null);
      try {
        let current = getAiAvailability();
        // `checking` is the mount probe still in flight; `error` is the one
        // state a probe does not cache - both mean "ask again"
        if (current.state === 'checking' || current.state === 'error') {
          current = await probeAiAvailability();
        }
        if (current.state === 'absent') {
          setStatus('This browser has no built-in AI.');
          return;
        }
        const text = await extractTabText(tab.chromeTabId);
        if (!text || !text.trim()) {
          setStatus('Could not read this tab.');
          return;
        }
        const session = await ensureAiSession(SUMMARIZE_SYSTEM_PROMPT);
        const summary = await summarizeTab(session, text);
        if (!summary.trim()) {
          setStatus('No summary came back - try again.');
          return;
        }
        const body = summaryNoteBody(tab.title, tab.url, summary);
        if (mode === 'append') {
          const target = getNoteEditor(selectedNoteId);
          if (target === null) {
            setStatus('No note is selected to append to.');
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
        setStatus('Added a note to this tabverse.');
      } catch (err) {
        logger.log('summarize tab failed', err);
        // the session is not worth keeping after a failed prompt
        evictAiSession(SUMMARIZE_SYSTEM_PROMPT);
        setStatus(
          getAiAvailability().state === 'absent'
            ? 'This browser has no built-in AI.'
            : 'Could not reach the on-device model - try again.',
        );
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [
      tab.chromeTabId,
      tab.suspended,
      tab.title,
      tab.url,
      tabSpaceId,
      selectedNoteId,
    ],
  );

  if (
    enabled !== true ||
    availability.state === 'checking' ||
    availability.state === 'absent'
  ) {
    return null;
  }

  const suspended = tab.suspended === true;
  return (
    <SummarizeTabButtonView
      busy={busy}
      disabled={suspended}
      canAppend={getNoteEditor(selectedNoteId) !== null}
      status={
        suspended
          ? SUMMARIZE_SUSPENDED_STATUS
          : (status ?? SUMMARIZE_READY_STATUS)
      }
      onSelect={(mode) => void run(mode)}
    />
  );
}
