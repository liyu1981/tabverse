import * as Moment from 'moment';
import * as React from 'react';

import { ISidebarComponentProps } from './Sidebar';
import { SavedChromeSessionCollection } from '../../../data/chromeSession/SavedChromeSessionCollection';
import { observer } from 'mobx-react-lite';
import { sum } from 'lodash';

function createStyles(): { [k: string]: React.CSSProperties } {
  return {
    container: {
      padding: '18px',
      fontSize: '1.2em',
      textAlign: 'right',
    },
    line: {
      marginBottom: '8px',
    },
  };
}

export type IBrowserSessionProps = ISidebarComponentProps & {
  savedChromeSessionCollection: SavedChromeSessionCollection;
};

export const BrowserSession = observer(
  ({ savedChromeSessionCollection }: IBrowserSessionProps) => {
    const styles = createStyles();

    const renderSavedChromeSessionSummary = () => {
      const count = sum(
        savedChromeSessionCollection.savedSessionGroups.map(
          (savedSessionGroup) => savedSessionGroup.sessions.length,
        ),
      );
      const formattedGroupTags = savedChromeSessionCollection.groupTags.map(
        (groupTag) => {
          return Moment(groupTag).calendar({
            sameDay: '[Today]',
            nextDay: '[Tomorrow]',
            nextWeek: 'dddd',
            lastDay: '[Yesterday]',
            lastWeek: '[Last] dddd',
            sameElse: 'DD/MM/YYYY',
          });
        },
      );
      return (
        <div style={styles.container}>
          <div style={styles.line}>
            <b>{`${count}`}</b> sessions saved
          </div>
          <div style={styles.line}>
            from <b>{`${formattedGroupTags[formattedGroupTags.length - 1]}`}</b>
          </div>
          <div style={styles.line}>
            to <b>{`${formattedGroupTags[0]}`}</b>
          </div>
        </div>
      );
    };

    return savedChromeSessionCollection.savedSessionGroups.length >= 1 ? (
      renderSavedChromeSessionSummary()
    ) : (
      <div></div>
    );
  },
);
