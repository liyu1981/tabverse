import { createEvent, createStore } from 'effector';

/**
 * The notebook's tab strip, as a store rather than component state.
 *
 * The note tool is rendered inside whichever Blueprint tabs host it - pinned or
 * unpinned - and pinning moves it from one tree to the other, which unmounts
 * it. The notes a person had open are about their work, not about where the
 * tool happens to sit, so they survive that move.
 */
export interface NotebookTabsState {
  /** The open note ids, in the order their tabs were opened. */
  openNoteIds: string[];
  /** The tab on screen; `null` is the pinned index tab. */
  activeTab: string | null;
}

const INITIAL: NotebookTabsState = { openNoteIds: [], activeTab: null };

export const $notebookTabs = createStore<NotebookTabsState>(INITIAL);

/** Open a note in a tab and show it. */
export const noteTabOpened = createEvent<string>();
/** Switch to a tab (a note id, or `null` for the index). */
export const noteTabActivated = createEvent<string | null>();
/** Close a note's tab; the neighbouring tab takes over when it was the active one. */
export const noteTabClosed = createEvent<string>();
/** A note is gone: drop its tab whatever was active. */
export const noteTabDropped = createEvent<string>();

$notebookTabs
  .on(noteTabOpened, (state, id) => ({
    openNoteIds: state.openNoteIds.includes(id)
      ? state.openNoteIds
      : [...state.openNoteIds, id],
    activeTab: id,
  }))
  .on(noteTabActivated, (state, id) => ({ ...state, activeTab: id }))
  .on(noteTabClosed, (state, id) => {
    const index = state.openNoteIds.indexOf(id);
    const openNoteIds = state.openNoteIds.filter((openId) => openId !== id);
    if (state.activeTab !== id) {
      return { openNoteIds, activeTab: state.activeTab };
    }
    return {
      openNoteIds,
      activeTab: openNoteIds[index] ?? openNoteIds[index - 1] ?? null,
    };
  })
  .on(noteTabDropped, (state, id) => ({
    openNoteIds: state.openNoteIds.filter((openId) => openId !== id),
    activeTab: state.activeTab === id ? null : state.activeTab,
  }));
