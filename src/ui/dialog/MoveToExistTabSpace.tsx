import { Button, Checkbox, Dialog, Intent } from '@blueprintjs/core';
import { EmptyQuery, Query, calcCursorBegin } from '../../fullTextSearch';
import {
  QUERY_PAGE_LIMIT_DEFAULT,
  addPagingToQueryParams,
} from '../../store/store';
import React, { useContext, useEffect, useState } from 'react';
import {
  moveTabsToTabSpace,
  querySavedTabSpace,
} from '../../data/tabSpace/SavedTabSpaceStore';

import { SearchInput as FullTextSearchInput } from '../../fullTextSearch/SearchInput';
import { IconName } from '@blueprintjs/icons';
import { LoadStatus } from '../../global';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ManagerViewContext } from '../manager/ManagerViewContext';
import Moment from 'moment';
import { Tab } from '../../data/tabSpace/Tab';
import { TabSpace } from '../../data/tabSpace/TabSpace';
import classes from './MoveToExistTabSpace.module.scss';
import clsx from 'clsx';
import { merge } from 'lodash';
import { scopeMap } from '../manager/SavedTabSpace/Search';
import { searchSavedTabSpace } from '../../background/fullTextSearch/search';

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

  const reloadCandidateTabSpaces = async () => {
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
      const [tabSpaces, nextCursor] = await searchSavedTabSpace({
        query,
        cursor: calcCursorBegin(query, QUERY_PAGE_LIMIT_DEFAULT),
      });
      setCandidateTabSpaces(tabSpaces);
    }
    setLoadStatus(LoadStatus.Done);
  };

  useEffect(() => {
    reloadCandidateTabSpaces();
  }, [query]);

  const renderCandidateTabSpaces = () => {
    if (candidateTabSpaces.length <= 0) {
      return <div>Found nothing, wrong search?</div>;
    } else {
      return (
        <div className={classes.candidateTopContainer}>
          {candidateTabSpaces.map((tabSpace) => {
            return (
              <div
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
                  created: {Moment(tabSpace.createdAt).fromNow()}, saved:
                  {Moment(tabSpace.updatedAt).fromNow()}
                </span>
              </div>
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
        message: 'Can not move tabs without selecting a target tabverse!',
      });
    } else {
      const commonToasterProps = {
        icon: 'git-new-branch' as IconName,
      };
      const key = managerViewContext.toaster.show(
        merge(commonToasterProps, {
          intent: Intent.NONE,
          message: `moving ${props.tabsForMoving.length} ${
            props.tabsForMoving.length > 1 ? 'tabs' : 'tab'
          } to ${searchSavedTabSpace.name}`,
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
          message: `moved ${props.tabsForMoving.length} ${
            props.tabsForMoving.length > 1 ? 'tabs' : 'tab'
          } to ${searchSavedTabSpace.name}`,
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
      title={'Move Selected Tabs To Other Tabverse'}
    >
      <div className={classes.contentContainer}>
        <div className={classes.searchInputContainer}>
          <FullTextSearchInput
            large={true}
            leftIcon={'search'}
            tagProps={{ minimal: true }}
            placeholder={'input keywords,  then ↵ enter to search...'}
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
              Close selected tabs after move
            </Checkbox>
          </div>
          <div className={classes.buttonContainer}>
            <Button className="tv-primary-button" onClick={() => onMove()}>
              Move
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
