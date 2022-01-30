import { AllBookmark, Bookmark } from '../data/bookmark/Bookmark';
import { AllNote, Note } from '../data/note/Note';
import { AllTodo, Todo } from '../data/todo/Todo';

import { ChromeSession } from '../data/chromeSession/ChromeSession';
import { Tab } from '../data/tabSpace/Tab';
import { TabSpace } from '../data/tabSpace/TabSpace';

export const schemas = {};

schemas[Tab.DB_TABLE_NAME] = Tab.DB_SCHEMA;
schemas[TabSpace.DB_TABLE_NAME] = TabSpace.DB_SCHEMA;
schemas[Todo.DB_TABLE_NAME] = Todo.DB_SCHEMA;
schemas[AllTodo.DB_TABLE_NAME] = AllTodo.DB_SCHEMA;
schemas[Note.DB_TABLE_NAME] = Note.DB_SCHEMA;
schemas[AllNote.DB_TABLE_NAME] = AllNote.DB_SCHEMA;
schemas[Bookmark.DB_TABLE_NAME] = Bookmark.DB_SCHEMA;
schemas[AllBookmark.DB_TABLE_NAME] = AllBookmark.DB_SCHEMA;
schemas[ChromeSession.DB_TABLE_NAME] = ChromeSession.DB_SCHEMA;
