import React, { useEffect, useState } from 'react';

import { SidebarComponentProps } from './Sidebar';
import Moment from 'moment';
import { getGroupTags } from '../../../data/chromeSession/SavedChromeSessionCollection';
import classes from './BrowserSession.module.scss';
import { sum } from 'lodash';
import { $savedChromeSessionCollection } from '../../../data/chromeSession/store';
import { useStore } from 'effector-react';

export type BrowserSessionProps = SidebarComponentProps;

export function BrowserSession(props: BrowserSessionProps) {
  const savedChromeSessionCollection = useStore($savedChromeSessionCollection);
  const [count, setCount] = useState<number>(0);

  const [formattedGroupTags, setFormattedGroupTags] = useState<string[]>([]);

  useEffect(() => {
    setCount(
      sum(
        savedChromeSessionCollection.savedSessionGroups.map(
          (savedSessionGroup) => savedSessionGroup.sessions.length,
        ),
      ),
    );
    setFormattedGroupTags(
      getGroupTags(savedChromeSessionCollection).map((groupTag) => {
        return Moment(groupTag).calendar({
          sameDay: '[Today]',
          nextDay: '[Tomorrow]',
          nextWeek: 'dddd',
          lastDay: '[Yesterday]',
          lastWeek: '[Last] dddd',
          sameElse: 'DD/MM/YYYY',
        });
      }),
    );
  }, [savedChromeSessionCollection.savedSessionGroups]);

  return savedChromeSessionCollection.savedSessionGroups.length >= 1 ? (
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
  ) : (
    <div></div>
  );
}
