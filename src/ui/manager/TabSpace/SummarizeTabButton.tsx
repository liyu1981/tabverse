/**
 * The summarize action on a live tab: read the page, summarize it with the
 * on-device model, and drop the result into a new note of this tabverse.
 *
 * The shape follows `SuggestNameButton` - a presentational view that can be
 * checked by what it renders, and a container that owns the availability
 * subscription, the run, and the failure line. The three rules it keeps:
 *
 * - **Hidden when absent or off** (plan D3/D10): while the browser has no
 *   built-in AI, or the person switched it off in Settings, the tab shows no
 *   button at all rather than one that does nothing.
 * - **The first click is the download consent** (plan D4): nothing runs at
 *   page load; the model downloads inside `session.ts` on the click.
 * - **One click, one note**: there is no candidate list to choose from - a
 *   summary is a single result, so it becomes a note named for the tab.
 *
 * Reading the page needs `chrome.scripting` (see `data/tabSpace/tabText.ts`),
 * which is why this is the feature that adds that permission.
 */
import { Button } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
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
import type { Tab } from '../../../data/tabSpace/Tab';
import { extractTabText } from '../../../data/tabSpace/tabText';
import { logger } from '../../../global';

/** The line under the button when nothing has happened yet. */
export const SUMMARIZE_READY_STATUS = 'Summarize this tab into a new note';

/** Why the button is disabled: a suspended tab has no page to read. */
export const SUMMARIZE_SUSPENDED_STATUS =
  'This tab is suspended - open it to load it, then summarize it';

export interface SummarizeTabButtonViewProps {
  busy: boolean;
  /** The one line: the offer, a progress note, or why it failed. */
  status: string;
  /** True while the tab is suspended and has no page to read. */
  disabled?: boolean;
  onSummarize: () => void;
}

/** The button, presentational so its states can be checked statically. */
export function SummarizeTabButtonView(props: SummarizeTabButtonViewProps) {
  return (
    <Button
      className="tv-icon-button"
      aria-label="Summarize this tab into a new note"
      title={props.status}
      icon="lightbulb"
      minimal={true}
      loading={props.busy}
      disabled={props.disabled}
      onClick={props.onSummarize}
    />
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
  const runningRef = useRef(false);

  useEffect(() => {
    void loadAiEnabled();
    void probeAiAvailability();
  }, []);

  const run = useCallback(async () => {
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
      await addNoteToTabSpace(
        tabSpaceId,
        newSummaryNote(
          summaryNoteName(tab.title),
          summaryNoteBody(tab.title, tab.url, summary),
        ),
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
  }, [tab.chromeTabId, tab.suspended, tab.title, tab.url, tabSpaceId]);

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
      status={
        suspended
          ? SUMMARIZE_SUSPENDED_STATUS
          : (status ?? SUMMARIZE_READY_STATUS)
      }
      onSummarize={() => void run()}
    />
  );
}
