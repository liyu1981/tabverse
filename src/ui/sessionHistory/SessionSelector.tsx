import * as Moment from 'moment';
import * as React from 'react';

import {
  Button,
  Colors,
  ControlGroup,
  HTMLSelect,
  Menu,
  MenuItem,
} from '@blueprintjs/core';
import {
  ChromeSession,
  IChromeSessionSavePayload,
} from '../../data/chromeSession/session';
import { flatten, merge, uniq } from 'lodash';

import { IDisplaySavedSessionGroup } from '../../data/chromeSession/sessionStore';
import { useState } from 'react';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    sessionSelectorMenu: {
      marginBottom: '40px',
    },
    sessionLabelActive: {
      borderLeft: `solid ${Colors.GRAY1}`,
    },
    sessionLabelContainer: {
      paddingLeft: '8px',
    },
    sessionLabelSub: {
      marginTop: '-10px',
      color: Colors.GRAY3,
    },
    sessionLabelContentContainer: {
      display: 'flex',
      alignItems: 'center',
    },
    sessionLabelContent: {
      width: '100%',
    },
    sessionLabelTools: {
      minWidth: '20px',
    },
    sessionMenuGroupSelector: {
      marginBottom: '8px',
    },
  };
}

interface SessionLabelProps {
  session: ChromeSession | IChromeSessionSavePayload;
  selected?: boolean;
  onDelete?: (sessionId: string) => void;
}

const SessionLabel = ({ session, selected, onDelete }: SessionLabelProps) => {
  const styles = createStyles();

  return (
    <div
      style={merge(
        styles.sessionLabelContainer,
        selected ? styles.sessionLabelActive : null,
      )}
    >
      <div style={styles.sessionLabelContentContainer}>
        <div style={styles.sessionLabelContent}>
          <div>
            <span title={session.id}>Session</span>
          </div>
          <div style={styles.sessionLabelSub}>
            <sub>Created at {Moment(session.createdAt).calendar()}</sub>
          </div>
          <div style={styles.sessionLabelSub}>
            <sub>Saved at {Moment(session.updatedAt).calendar()}</sub>
          </div>
        </div>
        <div style={styles.sessionLabelTools}>
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
  const styles = createStyles();

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
      <div style={styles.sessionMenuGroupSelector}>
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
              selected={session.id === selectedSession.id}
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
      <Menu style={styles.sessionSelectorMenu}>{renderSessionMenus()}</Menu>
    </div>
  );
};
