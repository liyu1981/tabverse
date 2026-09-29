/**
 * What the manager page can show.
 *
 * Its own module because the sidebar needs it and the sidebar is rendered by
 * the view that owns the enum: keeping it here breaks that import cycle, and it
 * is a routing concept rather than a view's business.
 */
export enum ManagerViewRoute {
  Opened = 'live',
  Saved = 'saved',
  Search = 'search',
  Webtool = 'webtool',
}

/** The query parameters a Tabverse tab was opened with (see `tabverseUrl`). */
export interface IManagerQueryParams {
  op: string;
  /** the tabverse id, minted when the tab was opened (see tabverseUrl) */
  tvid?: string;
  route?: string;
}
