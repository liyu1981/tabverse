/**
 * The auto-grouping dialog: a plan to review, edit and apply.
 *
 * `doc/tabverse-auto-grouping-plan.md` is the design. Two things are worth
 * knowing before reading the code:
 *
 *  - **Nothing is grouped until Apply**, and Apply re-validates the choices
 *    against the live window (`planAutoGroupApply`) - a dialog left open while
 *    tabs close or navigate cannot group the wrong ones.
 *  - **The body is a separate, presentational component.** Blueprint's `Dialog`
 *    renders through a portal, and a portal shows nothing under
 *    `renderToStaticMarkup` (the same note `NotePreviewDialog` and
 *    `MarkdownViewDialog` carry), so the states are checkable by what
 *    `AutoGroupBody` renders (ADR 0019).
 *
 * The site plan is computed once, when the dialog opens: it is a suggestion, and
 * a list that reshuffles under the cursor while a person edits it is worse than
 * one that is a moment old. The AI plan is computed when it is asked for, so it
 * starts from the tabs as they are then.
 */
import { t } from '../../../i18n';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  EditableText,
  Icon,
  Popover,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import React, {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  GROUPING_SYSTEM_PROMPT,
  suggestGroupsWithAi,
} from '../../../ai/grouping';
import { ensureAiSession } from '../../../ai/session';
import {
  getAiEnabled,
  loadAiEnabled,
  subscribeAiEnabled,
} from '../../../ai/aiSettings';
import {
  getAiAvailability,
  probeAiAvailability,
  subscribeAiAvailability,
} from '../../../ai/availability';
import type { Tab } from '../../../data/tabSpace/Tab';
import type {
  TabGroupColor,
  TabGroupHint,
} from '../../../data/tabSpace/TabSpace';
import { TAB_GROUP_COLORS } from '../../../data/tabSpace/TabSpace';
import {
  type AutoGroupChoice,
  type AutoGroupPlan,
  type AutoGroupSkipped,
  type AutoGroupSuggestion,
  type AutoGroupSuggestionTab,
  autoGroupCandidates,
  dominantSiteOfGroup,
  siteKeyOf,
  siteLabelOf,
  suggestAutoGroups,
  suggestionsFromAi,
} from '../../../data/tabSpace/autoGroup';
import {
  type AutoGroupApplyReportWithCounts,
  applyAutoGroupChoices,
} from '../../../data/tabSpace/autoGroupChrome';
import { resyncWindowAfterGrouping } from '../../../data/tabSpace/chromeTab';
import { TAB_GROUP_COLORS_JS } from '../../../data/tabSpace/tabGroup';
import { logger } from '../../../global';
import { $tabSpace } from '../../../data/tabSpace/store';
import { useStore } from 'effector-react';
import classes from './AutoGroupDialog.module.scss';

export type AutoGroupMode = 'site' | 'ai';

/** What the model is doing, for the line under the switch. */
export type AutoGroupAiState = 'idle' | 'busy' | 'ready' | 'error' | 'empty';

/** One suggestion, with the dialog's edits applied to it. */
export interface AutoGroupRow {
  id: string;
  kind: 'create' | 'extend';
  groupId?: string;
  key: string;
  title: string;
  color: TabGroupColor;
  selected: boolean;
  tabs: AutoGroupSuggestionTab[];
  /** The tabs still in the group; a subset of `tabs` after edits. */
  chosenTabIds: string[];
}

export interface AutoGroupBodyProps {
  rows: readonly AutoGroupRow[];
  skipped: AutoGroupSkipped;
  mode: AutoGroupMode;
  /** The AI switch is drawn only when the device has the model switched on. */
  aiEnabled: boolean;
  aiState: AutoGroupAiState;
  /** 0..1 while the model installs, null otherwise. */
  aiDownloadProgress: number | null;
  /** Apply is running; the buttons are disabled. */
  busy?: boolean;
  onModeChange: (mode: AutoGroupMode) => void;
  onToggleRow: (id: string, selected: boolean) => void;
  onTitleChange: (id: string, title: string) => void;
  onColorChange: (id: string, color: TabGroupColor) => void;
  onToggleTab: (id: string, tabId: string) => void;
  onApply: () => void;
  onClose: () => void;
  onRetryAi: () => void;
}

const MAX_GROUP_TITLE_LENGTH = 40;

/** The rows a plan starts as: everything selected, every tab kept. */
export function rowsFromSuggestions(
  suggestions: readonly AutoGroupSuggestion[],
): AutoGroupRow[] {
  return suggestions.map((suggestion) => ({
    id: suggestion.id,
    kind: suggestion.kind,
    groupId: suggestion.groupId,
    key: suggestion.key,
    title: suggestion.title,
    color: suggestion.color,
    selected: true,
    tabs: suggestion.tabs,
    chosenTabIds: suggestion.tabs.map((tab) => tab.tabId),
  }));
}

/** `https://github.com/a/b?q=1` -> `github.com/a/b?q=1`, for a tab row. */
function shortUrlOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** "3 of 4 tabs": how much of the row the person kept. */
function keptCount(row: AutoGroupRow): string {
  return t('autoGroupCountLabel', [
    String(row.chosenTabIds.length),
    String(row.tabs.length),
  ]);
}

function skippedLine(skipped: AutoGroupSkipped): string | null {
  const parts: string[] = [];
  if (skipped.pinned > 0) {
    parts.push(t('autoGroupSkippedPinned', [String(skipped.pinned)]));
  }
  if (skipped.alreadyGrouped > 0) {
    parts.push(t('autoGroupSkippedGrouped', [String(skipped.alreadyGrouped)]));
  }
  if (skipped.singletons > 0) {
    parts.push(t('autoGroupSkippedSingle', [String(skipped.singletons)]));
  }
  if (skipped.notWebPage > 0) {
    parts.push(t('autoGroupSkippedNotWeb', [String(skipped.notWebPage)]));
  }
  return parts.length > 0 ? t('autoGroupSkipped', [parts.join(', ')]) : null;
}

function ColorSwatch(props: {
  row: AutoGroupRow;
  disabled: boolean;
  onColorChange: (id: string, color: TabGroupColor) => void;
}) {
  const { row } = props;
  const content = (
    <div className={classes.colors}>
      {TAB_GROUP_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={classes.colorButton}
          style={{ backgroundColor: TAB_GROUP_COLORS_JS[color] }}
          title={color}
          aria-label={color}
          aria-pressed={color === row.color}
          onClick={() => props.onColorChange(row.id, color)}
        />
      ))}
    </div>
  );
  return (
    <Popover content={content} placement="bottom" disabled={props.disabled}>
      <button
        type="button"
        className={classes.swatch}
        style={{ backgroundColor: TAB_GROUP_COLORS_JS[row.color] }}
        aria-label={t('autoGroupColor')}
        title={t('autoGroupColor')}
        disabled={props.disabled}
      />
    </Popover>
  );
}

function TabFavIcon(props: { url: string }) {
  // no `FavIcon` here on purpose: it falls back to a remotely-hosted placeholder
  // for a tab without a favicon, and a plan of a hundred tabs should not fire a
  // hundred requests at a third party. A document glyph is enough at this size.
  return (
    <span className={classes.tabFavIcon}>
      {props.url ? (
        <img alt="" aria-hidden={true} src={props.url} />
      ) : (
        <Icon icon="document" size={12} />
      )}
    </span>
  );
}

function RowView(props: {
  row: AutoGroupRow;
  busy: boolean;
  onToggleRow: (id: string, selected: boolean) => void;
  onTitleChange: (id: string, title: string) => void;
  onColorChange: (id: string, color: TabGroupColor) => void;
  onToggleTab: (id: string, tabId: string) => void;
}) {
  const { row, busy } = props;
  const tooSmall = row.selected && row.chosenTabIds.length < 2;
  return (
    <div
      className={`${classes.card} ${row.selected ? '' : classes.cardOff}`}
      data-group-kind={row.kind}
      style={
        {
          '--group-color': TAB_GROUP_COLORS_JS[row.color],
        } as React.CSSProperties
      }
    >
      <div className={classes.cardHeader}>
        <Checkbox
          className={classes.rowCheck}
          checked={row.selected}
          disabled={busy}
          onChange={(event) =>
            props.onToggleRow(row.id, event.currentTarget.checked)
          }
        />
        <ColorSwatch
          row={row}
          disabled={busy || !row.selected}
          onColorChange={props.onColorChange}
        />
        <div className={classes.titleBlock}>
          <EditableText
            className={classes.titleInput}
            value={row.title}
            maxLength={MAX_GROUP_TITLE_LENGTH}
            disabled={busy || !row.selected}
            selectAllOnFocus={true}
            onChange={(value) => props.onTitleChange(row.id, value)}
          />
          <div className={classes.metaLine}>
            <span className={classes.rowCount}>{keptCount(row)}</span>
            {row.kind === 'extend' ? (
              <Tag minimal={true} className={classes.extendTag}>
                {t('autoGroupExtend')}
              </Tag>
            ) : null}
          </div>
        </div>
      </div>
      {tooSmall ? (
        <p className={classes.warning}>{t('autoGroupNeedTwo')}</p>
      ) : null}
      <ul className={classes.tabList}>
        {row.tabs.map((tab) => {
          const chosen = row.chosenTabIds.includes(tab.tabId);
          return (
            <li
              key={tab.tabId}
              className={
                chosen
                  ? classes.tabRow
                  : `${classes.tabRow} ${classes.tabRowOff}`
              }
            >
              <Checkbox
                className={classes.tabCheck}
                checked={chosen}
                disabled={busy || !row.selected}
                onChange={() => props.onToggleTab(row.id, tab.tabId)}
              />
              <TabFavIcon url={tab.favIconUrl} />
              <span className={classes.tabTitle} title={tab.title || tab.url}>
                {tab.title || tab.url}
              </span>
              <small className={classes.tabUrl} title={tab.url}>
                {shortUrlOf(tab.url)}
              </small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The dialog's contents, without the portal around them. */
export function AutoGroupBody(props: AutoGroupBodyProps) {
  const { rows, aiEnabled, aiState, aiDownloadProgress, busy } = props;
  const choosable = rows.filter(
    (row) => row.selected && row.chosenTabIds.length >= 2,
  );
  const tabsToGroup = choosable.reduce(
    (sum, row) => sum + row.chosenTabIds.length,
    0,
  );
  const applyDisabled = busy || choosable.length === 0;
  const applyLabel =
    choosable.length === 1
      ? t('autoGroupApplyOne', [String(tabsToGroup)])
      : t('autoGroupApplyMany', [
          String(tabsToGroup),
          String(choosable.length),
        ]);
  const skipped = skippedLine(props.skipped);

  return (
    <>
      <DialogBody className={classes.body}>
        <p className={classes.intro}>{t('autoGroupIntro')}</p>
        {aiEnabled ? (
          <div className={classes.modeRow}>
            <Button
              minimal={true}
              small={true}
              active={props.mode === 'site'}
              disabled={busy}
              text={t('autoGroupModeSite')}
              onClick={() => props.onModeChange('site')}
            />
            <Button
              minimal={true}
              small={true}
              icon="lightbulb"
              active={props.mode === 'ai'}
              disabled={busy}
              text={t('autoGroupModeAi')}
              onClick={() => props.onModeChange('ai')}
            />
          </div>
        ) : null}
        {props.mode === 'ai' ? (
          <div className={classes.aiLine}>
            {aiState === 'busy' ? (
              <>
                <Spinner size={14} />
                <span>{t('autoGroupAiBusy')}</span>
              </>
            ) : null}
            {aiDownloadProgress !== null ? (
              <span className={classes.hint}>
                {t('autoGroupAiDownloading', [
                  String(Math.round(aiDownloadProgress * 100)),
                ])}
              </span>
            ) : null}
            {aiState === 'error' ? (
              <>
                <span className={classes.aiError}>{t('autoGroupAiError')}</span>
                <Button
                  minimal={true}
                  small={true}
                  text={t('autoGroupRetry')}
                  onClick={props.onRetryAi}
                />
              </>
            ) : null}
            {aiState === 'empty' ? (
              <span className={classes.hint}>{t('autoGroupAiEmpty')}</span>
            ) : null}
          </div>
        ) : null}
        {rows.length === 0 && props.mode === 'site' ? (
          <p className={classes.nothing}>{t('autoGroupNothing')}</p>
        ) : null}
        {rows.length === 0 ? null : (
          <div className={classes.rows}>
            {rows.map((row) => (
              <RowView
                key={row.id}
                row={row}
                busy={busy === true}
                onToggleRow={props.onToggleRow}
                onTitleChange={props.onTitleChange}
                onColorChange={props.onColorChange}
                onToggleTab={props.onToggleTab}
              />
            ))}
          </div>
        )}
        {skipped ? <p className={classes.skipped}>{skipped}</p> : null}
      </DialogBody>
      <DialogFooter
        className={classes.footer}
        actions={
          <>
            <Button
              minimal={true}
              disabled={busy}
              text={t('commonCancel')}
              onClick={props.onClose}
            />
            <Button
              className="tv-primary-button"
              intent="primary"
              disabled={applyDisabled}
              loading={busy}
              text={choosable.length === 0 ? t('autoGroupApply') : applyLabel}
              onClick={props.onApply}
            />
          </>
        }
      />
    </>
  );
}

export interface AutoGroupDialogProps {
  /** The window's tabs, as the manager page has them. */
  tabs: readonly Tab[];
  /** The window's group hints, so the plan can add to an existing group. */
  groups: readonly TabGroupHint[];
  onClose: () => void;
  onApplied: (report: AutoGroupApplyReportWithCounts) => void;
}

function existingGroupsForAi(
  groups: readonly TabGroupHint[],
  tabs: readonly Tab[],
): { title: string; sites: string[] }[] {
  return groups.map((group) => {
    const sites = new Set<string>();
    for (const tabId of group.tabIds) {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      const key = siteKeyOf(tab?.url);
      if (key) {
        sites.add(key);
      }
    }
    const dominant = dominantSiteOfGroup(group, tabs);
    return {
      title: group.title || (dominant ? siteLabelOf(dominant) : ''),
      sites: Array.from(sites),
    };
  });
}

export function AutoGroupDialog(props: AutoGroupDialogProps) {
  const tabSpace = useStore($tabSpace);
  const aiEnabled =
    useSyncExternalStore(subscribeAiEnabled, getAiEnabled, () => false) ===
    true;
  const availability = useSyncExternalStore(
    subscribeAiAvailability,
    getAiAvailability,
    getAiAvailability,
  );

  // computed once: a suggestion, not a list that reshuffles under the cursor
  const [sitePlan] = useState<AutoGroupPlan>(() =>
    suggestAutoGroups(props.tabs, props.groups),
  );
  const [rows, setRows] = useState<AutoGroupRow[]>(() =>
    rowsFromSuggestions(sitePlan.suggestions),
  );
  const [mode, setMode] = useState<AutoGroupMode>('site');
  const [aiState, setAiState] = useState<AutoGroupAiState>('idle');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadAiEnabled();
  }, []);

  useEffect(() => {
    if (aiEnabled) {
      void probeAiAvailability();
    }
  }, [aiEnabled]);

  const update = useCallback((id: string, patch: Partial<AutoGroupRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }, []);

  const runAi = useCallback(async () => {
    setAiState('busy');
    try {
      const { candidates } = autoGroupCandidates(props.tabs, props.groups);
      if (candidates.length < 2) {
        setAiState('empty');
        setRows([]);
        return;
      }
      const session = await ensureAiSession(GROUPING_SYSTEM_PROMPT);
      const proposals = await suggestGroupsWithAi(
        session,
        candidates.map((tab) => ({ title: tab.title, url: tab.url })),
        existingGroupsForAi(props.groups, props.tabs),
      );
      const suggestions = suggestionsFromAi(
        proposals,
        candidates,
        props.groups.map((group) => group.color),
      );
      if (suggestions.length === 0) {
        setAiState('empty');
        setRows([]);
        return;
      }
      setRows(rowsFromSuggestions(suggestions));
      setAiState('ready');
    } catch (err) {
      // the model is optional: the by-site plan is one click away
      logger.log(
        'auto group: the on-device model could not group the tabs',
        err,
      );
      setAiState('error');
    }
  }, [props.tabs, props.groups]);

  const changeMode = useCallback(
    (next: AutoGroupMode) => {
      setMode(next);
      if (next === 'site') {
        setRows(rowsFromSuggestions(sitePlan.suggestions));
        setAiState('idle');
        return;
      }
      if (aiState === 'error' || aiState === 'empty') {
        void runAi();
        return;
      }
      if (aiState === 'idle') {
        void runAi();
      }
    },
    [aiState, runAi, sitePlan.suggestions],
  );

  const apply = useCallback(async () => {
    const choices: AutoGroupChoice[] = rows
      .filter((row) => row.selected && row.chosenTabIds.length >= 2)
      .map((row) => ({
        kind: row.kind,
        groupId: row.groupId,
        key: row.key || undefined,
        title: row.title.trim(),
        color: row.color,
        tabIds: row.chosenTabIds,
      }));
    if (choices.length === 0) {
      return;
    }
    setBusy(true);
    try {
      const report = await applyAutoGroupChoices(choices, {
        windowId: tabSpace.chromeWindowId,
        tabs: props.tabs,
      });
      // Chrome moves a group's tabs together; read the window back once so the
      // list and the saved tabverse match what the person now sees
      await resyncWindowAfterGrouping();
      props.onApplied(report);
      props.onClose();
    } finally {
      setBusy(false);
    }
  }, [props, rows, tabSpace.chromeWindowId]);

  return (
    <Dialog
      className={classes.dialog}
      isOpen={true}
      onClose={props.onClose}
      icon="group-objects"
      title={t('autoGroupDialogTitle')}
      canEscapeKeyClose={!busy}
      canOutsideClickClose={!busy}
    >
      <AutoGroupBody
        rows={rows}
        skipped={sitePlan.skipped}
        mode={mode}
        aiEnabled={aiEnabled}
        aiState={aiState}
        aiDownloadProgress={availability.progress}
        busy={busy}
        onModeChange={changeMode}
        onToggleRow={(id, selected) => update(id, { selected })}
        onTitleChange={(id, title) => update(id, { title })}
        onColorChange={(id, color) => update(id, { color })}
        onToggleTab={(id, tabId) =>
          setRows((current) =>
            current.map((row) =>
              row.id === id
                ? {
                    ...row,
                    chosenTabIds: row.chosenTabIds.includes(tabId)
                      ? row.chosenTabIds.filter((kept) => kept !== tabId)
                      : [...row.chosenTabIds, tabId],
                  }
                : row,
            ),
          )
        }
        onApply={() => void apply()}
        onClose={props.onClose}
        onRetryAi={() => void runAi()}
      />
    </Dialog>
  );
}
