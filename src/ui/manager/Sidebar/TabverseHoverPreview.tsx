import React, { useEffect, useState } from 'react';

import { FavIcon } from '../../common/FavIcon';
import {
  PREVIEW_TAB_LIMIT,
  PreviewTab,
  TabversePreview,
  readTabversePreview,
} from '../../../data/tabSpace/tabversePreview';
import tabCardClasses from '../TabSpace/TabCard.module.scss';
import classes from './TabverseHoverPreview.module.scss';

export interface TabversePreviewRowsProps {
  name: string;
  /** Undefined until the read lands: the panel is mounted on hover. */
  preview?: TabversePreview;
  limit?: number;
}

/**
 * The list part of the panel: what a tabverse has open, in tab strip order.
 *
 * Split from the read (which is in `TabverseHoverPreview`) so this is a pure
 * function of what was read and can be asserted on its own - the repo has no
 * component-test setup, and the markup is the part worth pinning.
 */
export function TabversePreviewRows(props: TabversePreviewRowsProps) {
  const limit = props.limit ?? PREVIEW_TAB_LIMIT;
  const preview = props.preview;

  return (
    <div className={tabCardClasses.previewCard}>
      <div
        className={`${tabCardClasses.previewHeaderContainer} ${classes.header}`}
      >
        <div className={tabCardClasses.previewTitle}>
          <h3
            className={`${tabCardClasses.previewTitleH} ${tabCardClasses.previewWrapText} ${classes.headerTitle}`}
            title={props.name}
          >
            {props.name}
          </h3>
        </div>
        <div className={classes.count}>
          {preview === undefined
            ? 'reading…'
            : `${preview.tabCount} tab${preview.tabCount === 1 ? '' : 's'}`}
        </div>
      </div>
      <div className={classes.list}>
        {preview === undefined ? (
          <div className={classes.empty}>…</div>
        ) : preview.tabs.length <= 0 ? (
          <div className={classes.empty}>No tabs open in this window.</div>
        ) : (
          <>
            {preview.tabs.map((tab: PreviewTab) => (
              <div key={tab.chromeTabId} className={classes.tabRow}>
                <FavIcon className={classes.favIcon} url={tab.favIconUrl} />
                <div className={classes.tabText}>
                  <div
                    className={`${tabCardClasses.previewWrapText} ${classes.tabTitle}`}
                    title={tab.title}
                  >
                    {tab.title}
                  </div>
                  <div
                    className={`${tabCardClasses.previewWrapText} ${classes.tabUrl}`}
                    title={tab.url}
                  >
                    {tab.url}
                  </div>
                </div>
              </div>
            ))}
            {preview.tabCount > limit ? (
              <div className={classes.more}>
                {`+${preview.tabCount - limit} more`}
              </div>
            ) : (
              ''
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The panel a sidebar row pops up on hover.
 *
 * Read-only on purpose: no close, no switch, no bookmark. A row here is meant
 * to tell two similarly named tabverses apart, and a button in it would be one
 * more place to act on a window that is not on screen (adr/0019 already had to
 * guard a dead close button on a saved tab for the same reason). The row's own
 * click still switches.
 *
 * The read happens here rather than in the row because Blueprint mounts popover
 * content only while the popover is open - so this component exists only for the
 * second the panel is up, and the query runs on a pointer that has already come
 * to rest.
 */
export function TabverseHoverPreview(props: {
  name: string;
  windowId: number;
}) {
  const [preview, setPreview] = useState<TabversePreview | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    void readTabversePreview(props.windowId).then((read) => {
      if (!cancelled) {
        setPreview(read);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.windowId]);

  return <TabversePreviewRows name={props.name} preview={preview} />;
}
