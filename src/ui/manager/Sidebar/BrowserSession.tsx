import * as Moment from 'moment';
import * as React from 'react';

import { ISidebarComponentProps } from './Sidebar';
import { SavedChromeSessionCollection } from '../../../data/chromeSession/SavedChromeSessionCollection';
import { observer } from 'mobx-react-lite';
import { sum } from 'lodash';
import classes from './BrowserSession.module.scss';

export type IBrowserSessionProps = ISidebarComponentProps & {
  savedChromeSessionCollection: SavedChromeSessionCollection;
};

export const BrowserSession = observer(
  ({ savedChromeSessionCollection }: IBrowserSessionProps) => {
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
        <div className={classes.noticeContainer}>
          <div className={classes.noticeLine}>
            <b>{`${count}`}</b> sessions saved
          </div>
          <div className={classes.noticeLine}>
            from <b>{`${formattedGroupTags[formattedGroupTags.length - 1]}`}</b>
          </div>
          <div className={classes.noticeLine}>
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
