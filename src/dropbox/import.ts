import { Dropbox } from 'dropbox';
import { importDb } from '../storage/dump';
import { logger } from '../global';

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
