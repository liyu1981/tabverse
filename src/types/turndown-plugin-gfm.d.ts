/**
 * `@joplin/turndown-plugin-gfm` ships no types. Only the entry the extension
 * uses is declared: `gfm` bundles the table, strikethrough, task-list and
 * highlighted-code rules and is passed to `TurndownService.use`.
 */
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export type TurndownPlugin = (service: TurndownService) => void;

  export const gfm: TurndownPlugin;
  export const tables: TurndownPlugin;
  export const strikethrough: TurndownPlugin;
  export const taskListItems: TurndownPlugin;
  export const highlightedCodeBlock: TurndownPlugin;
}
