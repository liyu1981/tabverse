import {
  Button,
  ControlGroup,
  HTMLSelect,
  Menu,
  MenuItem,
} from '@blueprintjs/core';
import {
  ChromeSession,
  IChromeSessionSavePayload,
  NotSessionId,
} from '../../../data/chromeSession/ChromeSession';
import React, { useState } from 'react';
import { flatten, uniq } from 'lodash';

import { IDisplaySavedSessionGroup } from '../../../data/chromeSession/sessionStore';
import Moment from 'moment';
import classes from './SessionSelector.module.scss';
import clsx from 'clsx';

interface SessionLabelProps {
  session: ChromeSession | IChromeSessionSavePayload;
  selected?: boolean;
  onDelete?: (sessionId: string) => void;
}

const SessionLabel = ({ session, selected, onDelete }: SessionLabelProps) => {
  return (
    <div
      className={clsx(
        classes.sessionLabelContainer,
        selected ? classes.sessionLabelActive : '',
      )}
    >
      <div className={classes.sessionLabelContentContainer}>
        <div className={classes.sessionLabelContent}>
          <div>
            <span title={session.id}>Session</span>
          </div>
          <div className={classes.sessionLabelSub}>
            <sub>Created at {Moment(session.createdAt).calendar()}</sub>
          </div>
          <div className={classes.sessionLabelSub}>
            <sub>Saved at {Moment(session.updatedAt).calendar()}</sub>
          </div>
        </div>
        <div className={classes.sessionLabelTools}>
          <Button
            minimal={true}
            icon="trash"
            onClick={() => onDelete && onDelete(session.id)}
          />
        </div>
      </div>
    </div>
  );
};

interface SessionSelectorProps {
  selectedSession: IChromeSessionSavePayload;
  sessions: IDisplaySavedSessionGroup[];
  onDeleteSession: (sessionId: string) => void;
  onSetSelectedSession: (session: IChromeSessionSavePayload) => void;
}

export const SessionSelector = ({
  selectedSession,
  sessions,
  onDeleteSession,
  onSetSelectedSession,
}: SessionSelectorProps) => {
  const groupTags = uniq(
    flatten(
      sessions.map((sessionGroup) => {
        return sessionGroup.sessions.map((session) => {
          return Moment(session.createdAt).startOf('day').valueOf();
        });
      }),
    ),
  ).sort((a, b) => b - a);

  const [selectedGroupTag, setSelectedGroupTag] = useState<number>(
    groupTags[0],
  );

  const calcSelectedSessions = (groupTag: number) => {
    return flatten(
      sessions.map((sessionGroup) => {
        return sessionGroup.sessions.filter(
          (session) =>
            Moment(session.createdAt).startOf('day').valueOf() === groupTag,
        );
      }),
    );
  };

  const selectGroup = (groupTag: number) => {
    const selectedSessions = calcSelectedSessions(groupTag);
    setSelectedGroupTag(groupTag);
    if (selectedSessions.length > 0) {
      onSetSelectedSession(selectedSessions[0]);
    }
  };

  const renderGroupTagSelector = () => {
    return (
      <div className={classes.sessionMenuGroupSelector}>
        <ControlGroup fill={true}>
          <HTMLSelect
            onChange={(e) => {
              selectGroup(parseInt(e.currentTarget.value));
            }}
          >
            {groupTags.map((groupTag) => (
              <option key={groupTag} value={groupTag}>
                {`${Moment(groupTag).calendar({
                  sameDay: '[Today]',
                  nextDay: '[Tomorrow]',
                  nextWeek: 'dddd',
                  lastDay: '[Yesterday]',
                  lastWeek: '[Last] dddd',
                  sameElse: 'DD/MM/YYYY',
                })}`}
              </option>
            ))}
          </HTMLSelect>
        </ControlGroup>
      </div>
    );
  };

  const renderSessionMenus = () => {
    const selectedSessions = calcSelectedSessions(selectedGroupTag);

    return selectedSessions.map((session) => {
      return (
        <MenuItem
          key={session.id}
          text={
            <SessionLabel
              session={session}
              selected={session.id === (selectedSession?.id ?? NotSessionId)}
              onDelete={onDeleteSession}
            />
          }
          onClick={() => onSetSelectedSession(session)}
        />
      );
    });
  };

  return (
    <div>
      {renderGroupTagSelector()}
      <Menu className={classes.sessionSelectorMenu}>
        {renderSessionMenus()}
      </Menu>
    </div>
  );
};
