import { Dropbox } from 'dropbox';
import { logger } from '../global';

export interface IDropboxBackupFileRecord {
  path_lower: string;
  server_modified: string;
}

export async function listDropboxFiles(
  accessToken: string,
  path: string,
  filterFn: (fileName: string) => boolean,
): Promise<IDropboxBackupFileRecord[]> {
  const client = new Dropbox({ accessToken });
  let results = await client.filesListFolder({ path, limit: 2 });
  let entries = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    logger.log('dropbox filesListFolder returns:', results.result.entries);
    entries = entries.concat(results.result.entries);
    if (results.result.has_more) {
      const { cursor } = results.result;
      results = await client.filesListFolderContinue({ cursor });
    } else {
      break;
    }
  }

  const sortedEntries = entries
    .filter((entry) => filterFn(entry.path_lower))
    .sort((a, b) => {
      const bServerModified = Date.parse((b as any).server_modified);
      const aServerModified = Date.parse((a as any).server_modified);
      return bServerModified - aServerModified;
    });
  return sortedEntries as any[] as IDropboxBackupFileRecord[];
}

export async function reloadBackupFiles(
  accessToken: string,
): Promise<IDropboxBackupFileRecord[]> {
  return listDropboxFiles(accessToken, '', (fileName) =>
    fileName.endsWith('.json'),
  );
}
