import * as Moment from 'moment';
import * as React from 'react';

import {
  Button,
  ButtonGroup,
  Colors,
  Tag,
  Tree,
  TreeNodeInfo,
} from '@blueprintjs/core';
import { useAsyncEffect } from '../common/useAsyncEffect';
import {
  SavedTabSpaceStore,
  querySavedTabSpace,
} from '../../data/tabSpace/tabSpaceStore';
import { TabSpaceRegistryMsg, sendChromeMessage } from '../../message';
import { addPagingToQueryParams, queryPageLimit } from '../../store/store';
import { map, merge } from 'lodash';

import { ErrorBoundary } from '../common/ErrorBoundary';
import { List } from 'immutable';
import { SavedTabSpacePreviewDialog } from './SavedTabSpacePreviewDialog';
import { TabSpace } from '../../data/tabSpace/tabSpace';
import { TabSpaceOp, LoadStatus } from '../../global';
import { TabSpaceRegistry } from '../../data/tabSpace/tabSpaceRegistry';
import { createTreeBaseStyles } from './OpenedTabSpaceTree';
import { observer } from 'mobx-react-lite';
import { useState, useEffect } from 'react';

interface ISavedTabSpaceTreeProps {
  tabSpace: TabSpace;
  tabSpaceRegistry: TabSpaceRegistry;
  savedTabSpaceStore: SavedTabSpaceStore;
}

enum SortMethods {
  CREATED = 0,
  SAVED = 1,
}

const SavedTabSpaceLabel = (props: {
  tabSpace: TabSpace;
  sortMethod: SortMethods;
}) => {
  const styles = createTreeBaseStyles();
  return (
    <span style={styles.clickable}>
      {props.tabSpace.name}
      <sub style={{ color: Colors.GRAY3 }}>
        {' '}
        (
        {props.sortMethod === SortMethods.CREATED
          ? Moment(props.tabSpace.createdAt).fromNow()
          : props.sortMethod === SortMethods.SAVED
          ? Moment(props.tabSpace.updatedAt).fromNow()
          : Moment(props.tabSpace.createdAt).fromNow()}
        )
      </sub>
    </span>
  );
};

function createStyles(): { [k: string]: React.CSSProperties } {
  return merge(createTreeBaseStyles(), {
    pagingControlContainer: {
      textAlign: 'center',
    },
  });
}

export const SavedTabSpaceTree = observer((props: ISavedTabSpaceTreeProps) => {
  const styles = createStyles();
  const { tabSpace, tabSpaceRegistry, savedTabSpaceStore } = props;

  const [isExpanded, setIsExpanded] = useState(true);
  const [previewSavedTabSpace, setPreviewSavedTabSpace] = useState(null);
  const [openedTabSpaces, setOpenedTabSpaces] = useState<TabSpace[]>([]);
  const [savedTabSpaces, setSavedTabSpaces] = useState<TabSpace[]>([]);
  const [savedTabSpacesPageStart, setSavedTabSpacesPageStart] = useState(0);
  const [onDiskNodesSortMethod, setOnDiskNodesSortMethod] =
    useState<SortMethods>(SortMethods.SAVED);
  const [loadStatus, setLoadStatus] = useState(LoadStatus.Loading);

  useAsyncEffect(async () => {
    const openedTabSpaceParams = {
      anyOf: List(tabSpaceRegistry.registry.keys()).toArray(),
    };
    const openedTabSpaces = await querySavedTabSpace(openedTabSpaceParams);
    const savedTabSpaceParams = addPagingToQueryParams(
      {
        noneOf: List(tabSpaceRegistry.registry.keys()).toArray(),
      },
      savedTabSpacesPageStart,
    );
    const savedTabSpaces = await querySavedTabSpace(savedTabSpaceParams);
    setOpenedTabSpaces(openedTabSpaces);
    setSavedTabSpaces(savedTabSpaces);
    setLoadStatus(LoadStatus.Done);
  }, [
    savedTabSpaceStore.savedDataVersion,
    savedTabSpacesPageStart,
    tabSpaceRegistry.registry,
  ]);

  const restoreSavedTabSpace = (tabSpace: any) => {
    chrome.windows.create((window) => {
      chrome.tabs.create({
        active: true,
        pinned: true,
        url: `manager.html?op=${TabSpaceOp.LoadSaved}&stsid=${tabSpace.id}`,
        windowId: window.id,
      });
    });
  };

  const loadToCurrentWindow = (stsid: string) => {
    async function action() {
      sendChromeMessage({
        type: TabSpaceRegistryMsg.RemoveTabSpace,
        payload: tabSpace.id,
      });
      window.open(
        `manager.html?op=${TabSpaceOp.LoadSaved}&stsid=${stsid}`,
        '_self',
      );
    }
    action();
  };

  const sortedOpenedTabSpaces =
    onDiskNodesSortMethod === SortMethods.SAVED
      ? openedTabSpaces.sort((a, b) => b.updatedAt - a.updatedAt)
      : openedTabSpaces.sort((a, b) => b.createdAt - a.createdAt);

  const openedChildNodes: TreeNodeInfo[] = map(sortedOpenedTabSpaces, (ts) => {
    return {
      id: ts.id,
      icon: 'git-repo',
      label: (
        <SavedTabSpaceLabel tabSpace={ts} sortMethod={onDiskNodesSortMethod} />
      ),
      tabSpace: ts,
      tabSpaceOpened: true,
      secondaryLabel: <Tag>opened</Tag>,
    } as TreeNodeInfo;
  });

  const openedNodes: TreeNodeInfo[] = [
    {
      id: 0,
      hasCaret: true,
      icon: 'saved',
      label: <b>{'Opened & Saved'}</b>,
      isExpanded: openedChildNodes.length > 0,
      childNodes: openedChildNodes,
    },
  ];

  const sortedSavedTabSpaces =
    onDiskNodesSortMethod === SortMethods.SAVED
      ? savedTabSpaces.sort((a, b) => b.updatedAt - a.updatedAt)
      : savedTabSpaces.sort((a, b) => b.createdAt - a.createdAt);

  const onDiskChildNodes: TreeNodeInfo[] = map(sortedSavedTabSpaces, (ts) => {
    return {
      id: ts.id,
      icon: 'git-repo',
      label: (
        <SavedTabSpaceLabel tabSpace={ts} sortMethod={onDiskNodesSortMethod} />
      ),
      tabSpace: ts,
      tabSpaceOpened: false,
    } as TreeNodeInfo;
  });

  const onDiskNodes: TreeNodeInfo[] = [
    {
      id: 0,
      hasCaret: true,
      icon: 'saved',
      label: <b>Saved</b>,
      isExpanded: isExpanded,
      childNodes: onDiskChildNodes,
    },
  ];

  const onDiskNodesSortMethodLabel = (
    <sub
      style={{ color: Colors.GRAY3, cursor: 'pointer' }}
      onClick={() => {
        setOnDiskNodesSortMethod((lastMethod) => {
          if (lastMethod === SortMethods.CREATED) {
            return SortMethods.SAVED;
          } else {
            return SortMethods.CREATED;
          }
        });
      }}
    >
      ({onDiskNodesSortMethod === SortMethods.CREATED ? 'created' : 'saved'})
    </sub>
  );

  const onNodeDoubleClick = (node) => {
    if (node.tabSpace && !node.tabSpaceOpened) {
      restoreSavedTabSpace(node.tabSpace);
    }
  };

  const closeSavedTabSpacePreviewDialog = () => setPreviewSavedTabSpace(null);

  const onNodeClick = (node) => {
    if (node.tabSpace && !node.tabSpaceOpened) {
      setPreviewSavedTabSpace(node.tabSpace);
    }
  };

  const totalPageCount = Math.ceil(
    (savedTabSpaceStore.totalSavedCount - openedTabSpaces.length) /
      queryPageLimit,
  );
  const pagingControl =
    totalPageCount > 1 ? (
      <ButtonGroup>
        <Button
          minimal={true}
          icon="chevron-left"
          onClick={() => {
            setSavedTabSpacesPageStart((lastStart) => {
              const newStart = lastStart - 1;
              return newStart > 0 ? newStart : 0;
            });
          }}
        ></Button>
        <Button minimal={true}>{`${
          savedTabSpacesPageStart + 1
        }/${totalPageCount}`}</Button>
        <Button
          minimal={true}
          icon="chevron-right"
          onClick={() => {
            setSavedTabSpacesPageStart((lastStart) => {
              const newStart = lastStart + 1;
              return newStart + 1 >= totalPageCount
                ? totalPageCount - 1
                : totalPageCount;
            });
          }}
        ></Button>
      </ButtonGroup>
    ) : (
      ''
    );

  return loadStatus === LoadStatus.Loading ? (
    <div>loading...</div>
  ) : (
    <div
      style={styles.container}
      data-saved-data-version={savedTabSpaceStore.savedDataVersion}
    >
      <ErrorBoundary>
        <div>
          <div style={styles.sectionHeadContainer}>
            Saved Tabverses {onDiskNodesSortMethodLabel}
          </div>
          <Tree contents={openedNodes} />
          <div data-sortmethod={onDiskNodesSortMethod}>
            <Tree
              contents={onDiskNodes}
              onNodeExpand={() => {
                setIsExpanded(true);
              }}
              onNodeCollapse={() => {
                setIsExpanded(false);
              }}
              onNodeDoubleClick={onNodeDoubleClick}
              onNodeClick={onNodeClick}
            />
            <SavedTabSpacePreviewDialog
              isOpen={previewSavedTabSpace ? true : false}
              tabSpace={previewSavedTabSpace ? previewSavedTabSpace : null}
              savedTabSpaceStore={savedTabSpaceStore}
              restoreFunc={restoreSavedTabSpace}
              closeFunc={closeSavedTabSpacePreviewDialog}
              loadToCurrentWindowFunc={loadToCurrentWindow}
            />
          </div>
        </div>
        <div style={styles.pagingControlContainer}>{pagingControl}</div>
      </ErrorBoundary>
    </div>
  );
});
