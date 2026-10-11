/**
 * The wand in the title row: suggest a name for this tabverse (plan
 * doc/tabverse-gemma-nano-plan.md).
 *
 * Container and content are split because the content is where the states
 * are rendered, and a component with no hooks of its own can be checked by
 * what it draws (ADR 0019's rule, and AGENTS.md's no-browser one):
 * `SuggestNamePopoverContent` takes fixed props and never reaches for the
 * model; `SuggestNameButton` owns the availability subscription, the run,
 * and the popover.
 *
 * The three rules the shape embodies:
 *
 * - **Hidden when absent** (D3, D10): while `checking` or `absent` the button
 *   does not render at all - a control that exists and does nothing is the
 *   pretending `capabilities.ts` forbids. The other states render and say
 *   what is going on in the popover's one line.
 * - **The first click is the download consent** (D4): opening the popover
 *   runs, and a `downloadable` model starts downloading inside `session.ts`
 *   with the progress shown here.
 * - **Nothing is applied without a click** (D6): candidates are buttons in a
 *   list; no selection, no auto-submit, and the reply was already sanitized
 *   by `naming.ts` before it became a candidate.
 */
import { Button, Popover } from '@blueprintjs/core';
// biome-ignore lint/correctness/noUnusedImports: classic jsx transform needs React in scope (tsconfig "jsx": "react"), TS2686 otherwise
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  type AiAvailability,
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
  NAMING_SYSTEM_PROMPT,
  type NameTab,
  suggestNames,
} from '../../../ai/naming';
import { ensureAiSession, evictAiSession } from '../../../ai/session';
import { logger } from '../../../global';
import classes from './SuggestNameButton.module.scss';

export interface SuggestNamePopoverContentProps {
  availability: AiAvailability;
  /** A run is in flight: the model may be downloading or thinking. */
  busy: boolean;
  /** The sanitized candidates, or null before any run finished. */
  candidates: string[] | null;
  /** The one line: why there is nothing to click. */
  note: string | null;
  onApply: (name: string) => void;
  onDismiss: () => void;
}

function downloadLine(availability: AiAvailability): string {
  const percent =
    availability.progress !== null
      ? ` ${Math.round(availability.progress * 100)}%`
      : '';
  return `Downloading the on-device model${percent}…`;
}

/** The popover's body: one line, or the list of names to click. */
export function SuggestNamePopoverContent(
  props: SuggestNamePopoverContentProps,
) {
  const { availability, busy, candidates, note, onApply, onDismiss } = props;

  // downloading wins over everything: it is the truth about this browser
  // right now, whether or not a run of ours is what started it
  if (availability.state === 'downloading') {
    return (
      <div className={classes.content}>
        <p className={classes.hint}>{downloadLine(availability)}</p>
      </div>
    );
  }

  if (busy) {
    return (
      <div className={classes.content}>
        <p className={classes.hint}>
          {availability.state === 'downloadable'
            ? 'Preparing the on-device model…'
            : 'Suggesting names…'}
        </p>
      </div>
    );
  }

  if (candidates && candidates.length > 0) {
    return (
      <div className={classes.content}>
        <div className={classes.candidates}>
          {candidates.map((name) => (
            <Button
              key={name}
              className={classes.candidate}
              fill={true}
              alignText="left"
              onClick={() => onApply(name)}
            >
              {name}
            </Button>
          ))}
        </div>
        <div className={classes.footer}>
          <Button minimal={true} small={true} onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <div className={classes.content}>
        <p className={classes.hint}>{note}</p>
      </div>
    );
  }

  if (availability.state === 'downloadable') {
    return (
      <div className={classes.content}>
        <p className={classes.hint}>
          The on-device model downloads once, the first time you use this.
        </p>
      </div>
    );
  }

  if (availability.state === 'error') {
    return (
      <div className={classes.content}>
        <p className={classes.hint}>
          The on-device model could not be reached - try again.
        </p>
      </div>
    );
  }

  return (
    <div className={classes.content}>
      <p className={classes.hint}>Pick a name for this tabverse.</p>
    </div>
  );
}

export interface SuggestNameButtonProps {
  /** This tabverse's tabs, which is all the prompt may ever see (D5). */
  tabs: NameTab[];
  /** Applies a chosen name - the same two calls a typed edit makes (D7). */
  onApply: (name: string) => void;
}

export function SuggestNameButton(props: SuggestNameButtonProps) {
  const { tabs, onApply } = props;
  const availability = useSyncExternalStore(
    subscribeAiAvailability,
    getAiAvailability,
    getAiAvailability,
  );
  // The person's switch (src/ai/aiSettings.ts), separate from the browser's
  // answer: `null` is "not read yet", which is not "off".
  const enabled = useSyncExternalStore(
    subscribeAiEnabled,
    getAiEnabled,
    getAiEnabled,
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const runningRef = useRef(false);

  // probe once on mount: the button's whole existence depends on the answer
  useEffect(() => {
    void loadAiEnabled();
    void probeAiAvailability();
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setBusy(true);
    setNote(null);
    setCandidates(null);
    try {
      let current = getAiAvailability();
      // `checking` is the mount probe still in flight; `error` is the one
      // state a probe does not cache - both mean "ask again" (D9)
      if (current.state === 'checking' || current.state === 'error') {
        current = await probeAiAvailability();
      }
      if (current.state === 'absent') {
        setNote('This browser has no built-in AI.');
        return;
      }
      if (tabs.length <= 0) {
        // a tabverse with no tabs is an empty offer, not an error (D6)
        setNote('This tabverse has no tabs to name yet.');
        return;
      }
      const session = await ensureAiSession(NAMING_SYSTEM_PROMPT);
      const names = await suggestNames(session, tabs);
      if (names.length > 0) {
        setCandidates(names);
      } else {
        setNote('No names came back - try again.');
      }
    } catch (err) {
      logger.log('name suggestion failed', err);
      // the session is not worth keeping after a failed prompt (D9)
      evictAiSession(NAMING_SYSTEM_PROMPT);
      setNote(
        getAiAvailability().state === 'absent'
          ? 'This browser has no built-in AI.'
          : 'Could not reach the on-device model - try again.',
      );
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [tabs]);

  const apply = useCallback(
    (name: string) => {
      setOpen(false);
      onApply(name);
    },
    [onApply],
  );

  // one entry point for open and close: Blueprint routes the target click,
  // Escape and outside clicks through onInteraction in controlled mode, so
  // run() hangs off the opening transition and cannot double-fire
  const onInteraction = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen && !open) {
        void run();
      }
      setOpen(nextOpen);
    },
    [open, run],
  );

  if (
    enabled !== true ||
    availability.state === 'checking' ||
    availability.state === 'absent'
  ) {
    // checking is a millisecond probe; absent is permanent; and "off" is the
    // person's answer in the settings dialog - in all three the row has no
    // dead button in it.
    return null;
  }

  return (
    <Popover
      isOpen={open}
      onInteraction={onInteraction}
      placement="bottom-end"
      portalClassName={classes.suggestPopover}
      content={
        <SuggestNamePopoverContent
          availability={availability}
          busy={busy}
          candidates={candidates}
          note={note}
          onApply={apply}
          onDismiss={() => setOpen(false)}
        />
      }
    >
      <Button
        className="tv-icon-button"
        aria-label="Suggest a name for this tabverse"
        icon="lightbulb"
        minimal={true}
        loading={busy}
      />
    </Popover>
  );
}
