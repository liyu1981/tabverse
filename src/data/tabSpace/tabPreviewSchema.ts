/**
 * Where the tab preview table lives, in a module of its own with no imports.
 *
 * It exists purely to break a dependency cycle: `storage/schema.ts` needs these
 * two constants, and the store that *uses* them needs `storage/db`, which is
 * built from the schema. Importing the store from the schema would close the
 * loop (db -> TabSpaceDatabase -> schema -> store -> db) and leave
 * TabSpaceDatabase half-initialised.
 */

export const TAB_PREVIEW_DB_TABLE_NAME = 'SavedTabPreview';
export const TAB_PREVIEW_DB_SCHEMA = 'id, capturedAt';

/**
 * Upper bound on stored thumbnails per profile. A tabverse with hundreds of
 * tabs is unusual, and a few MB of base64 data URLs in IndexedDB is a lot for
 * something only ever shown on hover. Oldest are dropped first.
 */
export const MAX_STORED_PREVIEWS = 100;
