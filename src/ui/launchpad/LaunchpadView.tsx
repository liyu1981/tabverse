import { Button, ButtonGroup, Tooltip } from '@blueprintjs/core';
import React, { useState } from 'react';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { LaunchpadGrid } from './LaunchpadGrid';
import { ListFilter } from '../common/ListFilter';
import {
  SHORTCUT_ORDER_ALPHABETICAL,
  SHORTCUT_ORDER_NEWEST,
  Shortcut,
  ShortcutOrder,
  orderShortcuts,
  shortcutDisplayName,
} from '../../data/shortcut/Shortcut';
import { deleteShortcut } from '../../data/shortcut/util';
import { filterByText } from '../../data/search/inMemorySearch';
import {
  LAUNCHPAD_ORDER_KEY,
  parseLaunchpadOrder,
  serializeLaunchpadOrder,
} from './order';
import { t } from '../../i18n';
import { useSettingItem } from '../../storage/localSetting';
import { useStore } from 'effector-react';
import { $shortcuts } from '../../data/shortcut/store';
import classes from './Launchpad.module.scss';

/**
 * The Launchpad: every shortcut the account holds, as a grid of tiles.
 *
 * Unlike the tabverse tools it is not about the current window: a shortcut has
 * no tabverse, so the rows come from the account-level table loaded at
 * bootstrap and kept current by the DB-change monitor. Everything it does is
 * local (open, filter, order, delete); the sync is the ordinary record stream.
 */
export function LaunchpadView() {
  const shortcuts = useStore($shortcuts);
  const [filterText, setFilterText] = useState('');
  const [storedOrder, setStoredOrder] = useSettingItem<ShortcutOrder>(
    LAUNCHPAD_ORDER_KEY,
    parseLaunchpadOrder,
    serializeLaunchpadOrder,
  );
  const order = parseLaunchpadOrder(storedOrder);

  const filtered = filterByText(
    shortcuts,
    (shortcut) => `${shortcutDisplayName(shortcut)} ${shortcut.url}`,
    filterText,
  );
  const ordered = orderShortcuts(filtered, order);
  const filtering = filterText.trim().length > 0;

  const remove = (shortcut: Shortcut) => {
    void deleteShortcut(shortcut.id);
  };

  return (
    <ErrorBoundary>
      <div className={classes.container}>
        <div className={classes.inner}>
          <div className={classes.header}>
            <h1 className={classes.title}>{t('launchpadTitle')}</h1>
            <div className={classes.controls}>
              <div className={classes.filter}>
                <ListFilter
                  value={filterText}
                  onChange={setFilterText}
                  placeholder={t('launchpadFilterPlaceholder')}
                  count={filtered.length}
                  total={shortcuts.length}
                  ariaLabel={t('launchpadFilterAria')}
                />
              </div>
              <ButtonGroup className={classes.orderGroup}>
                <Tooltip content={t('launchpadOrderName')} placement="bottom">
                  <Button
                    icon="sort-alphabetical"
                    minimal={true}
                    active={order === SHORTCUT_ORDER_ALPHABETICAL}
                    aria-pressed={order === SHORTCUT_ORDER_ALPHABETICAL}
                    aria-label={t('launchpadOrderName')}
                    onClick={() => setStoredOrder(SHORTCUT_ORDER_ALPHABETICAL)}
                  />
                </Tooltip>
                <Tooltip content={t('launchpadOrderNewest')} placement="bottom">
                  <Button
                    icon="sort-desc"
                    minimal={true}
                    active={order === SHORTCUT_ORDER_NEWEST}
                    aria-pressed={order === SHORTCUT_ORDER_NEWEST}
                    aria-label={t('launchpadOrderNewest')}
                    onClick={() => setStoredOrder(SHORTCUT_ORDER_NEWEST)}
                  />
                </Tooltip>
              </ButtonGroup>
            </div>
          </div>
          <LaunchpadGrid
            shortcuts={ordered}
            total={shortcuts.length}
            filtering={filtering}
            onDelete={remove}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}
