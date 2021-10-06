import { dumpDb, importDb } from '../store/dump';

import { Dropbox } from 'dropbox';
import { logger } from '../global';

export enum VerifyStatus {
  NotYetPerformed = 0,
  Verifying = 1,
  Failed = 2,
  Succeeded = 3,
}

export async function validateDropboxAccessToken(
  accessToken: string,
  setAccessTokenVerifyStatus: React.Dispatch<
    React.SetStateAction<VerifyStatus>
  >,
  saveAccessTokenFn: (accessToken: string) => void,
) {
  if (!accessToken || accessToken.length <= 0) {
    return;
  }
  setAccessTokenVerifyStatus(VerifyStatus.Verifying);
  const client = new Dropbox({ accessToken });
  try {
    const result = await client.checkUser({ query: 'tabverse' });
    if (result.result.result === 'tabverse') {
      setAccessTokenVerifyStatus(VerifyStatus.Succeeded);
      // if it is validated, then we call the saver
      saveAccessTokenFn(accessToken);
    } else {
      setAccessTokenVerifyStatus(VerifyStatus.Failed);
    }
  } catch (e) {
    setAccessTokenVerifyStatus(VerifyStatus.Failed);
  }
}

export interface IDropboxBackupFileRecord {
  path_lower: string;
  server_modified: string;
}

export async function reloadBackupFiles(
  accessToken: string,
): Promise<IDropboxBackupFileRecord[]> {
  const client = new Dropbox({ accessToken });
  const results = await client.filesListFolder({ path: '' });
  logger.log('dropbox filesListFolder returns:', results.result.entries);
  const sortedEntries = results.result.entries.sort((a, b) => {
    const bServerModified = Date.parse((b as any).server_modified);
    const aServerModified = Date.parse((a as any).server_modified);
    return bServerModified - aServerModified;
  });
  return sortedEntries as any[] as IDropboxBackupFileRecord[];
}

export async function backupToDropbox(
  accessToken: string,
  targetFilePath: string,
) {
  logger.info('start backupToDropbox');
  const client = new Dropbox({ accessToken });
  // TODO: very naive method to get all data into one string
  // according to here https://stackoverflow.com/a/65570725, the max is <512MB
  const contents = await dumpDb();
  await client.filesUpload({
    path: targetFilePath,
    contents,
  });
  logger.info('file uploaded!');
}

export async function importFromDropbox(accessToken: string, path: string) {
  if (path.length > 0) {
    logger.info('start to import from', path);
    const client = new Dropbox({ accessToken });
    const result = await client.filesDownload({ path });
    logger.log('dropbox filesDownload returns:', result);
    const fileBlob = (result.result as any).fileBlob;
    const fileText = await fileBlob.text();
    const backupObjs: { tabName: string; records: any[] }[] =
      JSON.parse(fileText);
    await importDb(
      backupObjs,
      (tabName: string, recordDone: number, recordTotal: number) => {
        logger.info(`import ${tabName} record ${recordDone}/${recordTotal}`);
      },
    );
  }
}
