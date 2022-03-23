import { ChromeSession } from '../data/chromeSession/ChromeSession';
import { Tab } from '../data/tabSpace/Tab';
import { TabSpace } from '../data/tabSpace/TabSpace';
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

schemas[Tab.DB_TABLE_NAME] = Tab.DB_SCHEMA;
schemas[TabSpace.DB_TABLE_NAME] = TabSpace.DB_SCHEMA;
schemas[TODO_DB_TABLE_NAME] = TODO_DB_SCHEMA;
schemas[ALLTODO_DB_TABLE_NAME] = ALLTODO_DB_SCHEMA;
schemas[NOTE_DB_TABLE_NAME] = NOTE_DB_SCHEMA;
schemas[ALLNOTE_DB_TABLE_NAME] = ALLNOTE_DB_SCHEMA;
schemas[BOOKMARK_DB_TABLE_NAME] = BOOKMARK_DB_SCHEMA;
schemas[ALLBOOKMARK_DB_TABLE_NAME] = ALLBOOKMARK_DB_SCHEMA;
schemas[ChromeSession.DB_TABLE_NAME] = ChromeSession.DB_SCHEMA;
