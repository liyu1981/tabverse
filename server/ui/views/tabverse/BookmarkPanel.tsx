import React from 'react';

import bookmarkClasses from '../../../../src/ui/bookmark/BookmarkView.module.scss';
import type { Bookmark } from '../../data/tabverseAdapter';

/**
 * The extension's bookmark list, read.
 *
 * Same rows and the same stylesheet: a 32px icon, the name in bold over the url.
 * The extension's row wraps the name in an `EditableText` and carries two
 * buttons - open in this tabverse, delete - and both are gone: one acts on this
 * browser's windows, the other writes a record this surface may not write.
 * The url is text here for the same reason a note body is.
 */
export function BookmarkPanel(props: { bookmarks: Bookmark[] }) {
  if (!props.bookmarks.length) {
    return (
      <div className={bookmarkClasses.noticeContainer}>
        No bookmark stored with this tabverse.
      </div>
    );
  }

  return (
    <div className={bookmarkClasses.container}>
      <ul className={bookmarkClasses.listContainer}>
        {props.bookmarks.map((bookmark) => (
          <li key={bookmark.id}>
            <div className={bookmarkClasses.listItemView}>
              <div className={bookmarkClasses.favIcon}>
                {/* decorative: the name is right next to it. The url is the
                    row's own icon, so a missing one draws an empty box rather
                    than fetching a placeholder from a third party. */}
                {bookmark.favIconUrl ? (
                  <img
                    alt=""
                    aria-hidden={true}
                    src={bookmark.favIconUrl}
                    width="32"
                    height="32"
                  />
                ) : null}
              </div>
              <div className={bookmarkClasses.label}>
                <div>
                  <b>{bookmark.name || '(unnamed)'}</b>
                </div>
                <small>{bookmark.url}</small>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
