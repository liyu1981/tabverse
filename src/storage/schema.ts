import {
  CHROMESESSION_DB_SCHEMA,
  CHROMESESSION_DB_TABLE_NAME,
} from '../data/chromeSession/ChromeSession';
import { TAB_DB_SCHEMA, TAB_DB_TABLE_NAME } from '../data/tabSpace/Tab';
import {
  TABSPACE_DB_SCHEMA,
  TABSPACE_DB_TABLE_NAME,
} from '../data/tabSpace/TabSpace';
import { TODO_DB_TABLE_NAME, TODO_DB_SCHEMA } from '../data/todo/Todo';
import { ALLTODO_DB_SCHEMA, ALLTODO_DB_TABLE_NAME } from '../data/todo/AllTodo';
import { NOTE_DB_TABLE_NAME, NOTE_DB_SCHEMA } from '../data/note/Note';
import { ALLNOTE_DB_TABLE_NAME, ALLNOTE_DB_SCHEMA } from '../data/note/AllNote';
import {
  BOOKMARK_DB_SCHEMA,
  BOOKMARK_DB_TABLE_NAME,
} from '../data/bookmark/Bookmark';
import {
  ALLBOOKMARK_DB_SCHEMA,
  ALLBOOKMARK_DB_TABLE_NAME,
} from '../data/bookmark/AllBookmark';

export const schemas = {};

schemas[TAB_DB_TABLE_NAME] = TAB_DB_SCHEMA;
schemas[TABSPACE_DB_TABLE_NAME] = TABSPACE_DB_SCHEMA;
schemas[TODO_DB_TABLE_NAME] = TODO_DB_SCHEMA;
schemas[ALLTODO_DB_TABLE_NAME] = ALLTODO_DB_SCHEMA;
schemas[NOTE_DB_TABLE_NAME] = NOTE_DB_SCHEMA;
schemas[ALLNOTE_DB_TABLE_NAME] = ALLNOTE_DB_SCHEMA;
schemas[BOOKMARK_DB_TABLE_NAME] = BOOKMARK_DB_SCHEMA;
schemas[ALLBOOKMARK_DB_TABLE_NAME] = ALLBOOKMARK_DB_SCHEMA;
schemas[CHROMESESSION_DB_TABLE_NAME] = CHROMESESSION_DB_SCHEMA;
