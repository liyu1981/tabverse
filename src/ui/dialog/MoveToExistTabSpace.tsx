import { fromNow } from '../../time';
import { Button, Checkbox, Dialog, Intent } from '@blueprintjs/core';
import { EmptyQuery, Query, searchSavedTabSpaces } from '../../data/search';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import { t } from '../../i18n';
import {
  moveTabsToTabSpace,
  querySavedTabSpace,
} from '../../data/tabSpace/util';

import { SearchInput as FullTextSearchInput } from '../common/SearchInput';
import { IconName } from '@blueprintjs/icons';
import { LoadStatus } from '../../global';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ManagerViewContext } from '../manager/ManagerViewContext';
import { Tab } from '../../data/tabSpace/Tab';
import { TabSpace } from '../../data/tabSpace/TabSpace';
import classes from './MoveToExistTabSpace.module.scss';
import clsx from 'clsx';
import { merge } from 'lodash';
import { scopeMap } from '../manager/SavedTabSpace/Search';
import {
  addPagingToQueryParams,
  QUERY_PAGE_LIMIT_DEFAULT,
} from '../../storage/db';

export interface MoveToExistTabverseDialogProps {
  tabsForMoving: Tab[];
  isOpen: boolean;
  onClose: any;
}

export function MoveToExistTabSpaceDialog(
  props: MoveToExistTabverseDialogProps,
) {
  const [query, setQuery] = useState<Query>(EmptyQuery);
  const [candidateTabSpaces, setCandidateTabSpaces] = useState<TabSpace[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(LoadStatus.Done);
  const [selectedCandidateTabSpace, setSelectedCandidateTabSpace] =
    useState<TabSpace>(null);
  const [removeAfterMove, setRemoveAfterMove] = useState<boolean>(true);
  const managerViewContext = useContext(ManagerViewContext);

  // useCallback so the effect can depend on the loader itself instead of
  // reaching past it into `query`
  const reloadCandidateTabSpaces = useCallback(async () => {
    setLoadStatus(LoadStatus.Loading);
    if (query.isEmpty()) {
      const savedTabSpaceParams = addPagingToQueryParams(
        {},
        0,
        QUERY_PAGE_LIMIT_DEFAULT,
      );
      const tabSpaces = await querySavedTabSpace(savedTabSpaceParams);
      setCandidateTabSpaces(tabSpaces);
    } else {
      const result = await searchSavedTabSpaces(query);
      setCandidateTabSpaces(
        result.tabSpaces.slice(0, QUERY_PAGE_LIMIT_DEFAULT),
      );
    }
    setLoadStatus(LoadStatus.Done);
  }, [query]);

  useEffect(() => {
    reloadCandidateTabSpaces();
  }, [reloadCandidateTabSpaces]);

  const renderCandidateTabSpaces = () => {
    if (candidateTabSpaces.length <= 0) {
      return <div>{t('moveFoundNothing')}</div>;
    } else {
      return (
        <div className={classes.candidateTopContainer}>
          {candidateTabSpaces.map((tabSpace) => {
            return (
              <button
                type="button"
                key={tabSpace.id}
                className={clsx(
                  classes.candidateContainer,
                  selectedCandidateTabSpace === tabSpace
                    ? classes.candidateContainerSelected
                    : null,
                )}
                onClick={() => {
                  setSelectedCandidateTabSpace((lastSelected) => {
                    return lastSelected === tabSpace ? null : tabSpace;
                  });
                }}
              >
                <span className={classes.candidateName}>{tabSpace.name}</span>
                <span className={classes.candidateInfo}>
                  {t('moveCandidateInfo', [
                    fromNow(tabSpace.createdAt),
                    fromNow(tabSpace.updatedAt),
                  ])}
                </span>
              </button>
            );
          })}
        </div>
      );
    }
  };

  const onMove = async () => {
    if (selectedCandidateTabSpace === null) {
      managerViewContext.toaster.show({
        icon: 'error',
        intent: Intent.WARNING,
        message: t('moveNoTargetToast'),
      });
      // the toast above is a warning, not a cancel: without this the move ran
      // with a null target
      return;
    } else {
      const commonToasterProps = {
        icon: 'git-new-branch' as IconName,
      };
      const key = managerViewContext.toaster.show(
        merge(commonToasterProps, {
          intent: Intent.NONE,
          message: t(
            props.tabsForMoving.length > 1
              ? 'moveMovingToastMany'
              : 'moveMovingToastOne',
            [
              String(props.tabsForMoving.length),
              selectedCandidateTabSpace.name,
            ],
          ),
        }),
      );
      await moveTabsToTabSpace(props.tabsForMoving, selectedCandidateTabSpace);
      if (removeAfterMove) {
        await Promise.all(
          props.tabsForMoving.map((tab) => chrome.tabs.remove(tab.chromeTabId)),
        );
      }
      managerViewContext.toaster.show(
        merge(commonToasterProps, {
          intent: Intent.SUCCESS,
          message: t(
            props.tabsForMoving.length > 1
              ? 'moveMovedToastMany'
              : 'moveMovedToastOne',
            [
              String(props.tabsForMoving.length),
              selectedCandidateTabSpace.name,
            ],
          ),
        }),
        key,
      );
      props.onClose();
    }
  };

  return (
    <Dialog
      isOpen={props.isOpen}
      canOutsideClickClose={true}
      onClose={props.onClose}
      title={t('moveDialogTitle')}
    >
      <div className={classes.contentContainer}>
        <div className={classes.searchInputContainer}>
          <FullTextSearchInput
            large={true}
            leftIcon={'search'}
            tagProps={{ minimal: true }}
            placeholder={t('moveSearchPlaceholder')}
            query={query}
            onChangeQuery={setQuery}
            scopeDefault={scopeMap['anywhere']}
            scopeMap={scopeMap}
          />
        </div>
        <div className={classes.searchResultContainer}>
          {loadStatus === LoadStatus.Loading ? (
            <LoadingSpinner />
          ) : (
            renderCandidateTabSpaces()
          )}
        </div>
        <div>
          <div className={classes.optionContainer}>
            <Checkbox
              checked={removeAfterMove}
              onClick={() => setRemoveAfterMove((lastValue) => !lastValue)}
            >
              {t('moveCloseAfterMove')}
            </Checkbox>
          </div>
          <div className={classes.buttonContainer}>
            <Button className="tv-primary-button" onClick={() => onMove()}>
              {t('moveMoveButton')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
