import { AllBookmark, Bookmark } from '../data/bookmark/Bookmark';
import { AllNote, Note } from '../data/note/Note';

import { ChromeSession } from '../data/chromeSession/ChromeSession';
import { Tab } from '../data/tabSpace/Tab';
import { TabSpace } from '../data/tabSpace/TabSpace';
import { TODO_DB_TABLE_NAME } from '../data/todo/Todo';
import { ALLTODO_DB_SCHEMA, ALLTODO_DB_TABLE_NAME } from '../data/todo/AllTodo';
import { TODO_DB_SCHEMA } from '../data/todo/Todo';

export const schemas = {};

schemas[Tab.DB_TABLE_NAME] = Tab.DB_SCHEMA;
schemas[TabSpace.DB_TABLE_NAME] = TabSpace.DB_SCHEMA;
schemas[TODO_DB_TABLE_NAME] = TODO_DB_SCHEMA;
schemas[ALLTODO_DB_TABLE_NAME] = ALLTODO_DB_SCHEMA;
schemas[Note.DB_TABLE_NAME] = Note.DB_SCHEMA;
schemas[AllNote.DB_TABLE_NAME] = AllNote.DB_SCHEMA;
schemas[Bookmark.DB_TABLE_NAME] = Bookmark.DB_SCHEMA;
schemas[AllBookmark.DB_TABLE_NAME] = AllBookmark.DB_SCHEMA;
schemas[ChromeSession.DB_TABLE_NAME] = ChromeSession.DB_SCHEMA;
