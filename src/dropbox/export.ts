import * as md5sum from 'crypto-js/md5';

import {
  SETTING_KEY_DROPBOX_ACCESSTOKEN,
  SETTING_KEY_DROPBOX_AUTOBACKUP,
} from '../ui/dialog/DropboxDialog';

import { Dropbox } from 'dropbox';
import { dumpDb } from '../store/dump';
import { getSettingItem } from '../store/localSetting';
import { listDropboxFiles } from './list';
import { logger } from '../global';

export function generateNewDropboxBackupFileName(tag?: string) {
  return `/tabverse-backup-${tag ? tag + '-' : ''}${Date.now()}.json`;
}

export function generateNewDropboxBackupFileChecksumName(
  backupFileName: string,
) {
  const nameWithoutExt = backupFileName.replace(/\.json$/, '');
  return `${nameWithoutExt}.md5.txt`;
}

export async function exportToDropbox(
  accessToken: string,
  targetFilePath: string,
  lastBackupMd5?: string,
) {
  logger.info('start exportToDropbox');
  const client = new Dropbox({ accessToken });
  // TODO: very naive method to get all data into one string
  // according to here https://stackoverflow.com/a/65570725, the max is <512MB
  const contents = await dumpDb();
  const contentsMd5 = md5sum(contents);
  const willBackup = lastBackupMd5
    ? contentsMd5.toString() === lastBackupMd5
    : true;
  if (willBackup) {
    const contentsMd5FilePath =
      generateNewDropboxBackupFileChecksumName(targetFilePath);
    await client.filesUpload({
      path: targetFilePath,
      contents,
    });
    await client.filesUpload({
      path: contentsMd5FilePath,
      contents: contentsMd5,
    });
    logger.info('file uploaded!');
  } else {
    logger.info(
      'export skipped because current contentsMd5 !== lastBackupMd5',
      contentsMd5,
      lastBackupMd5,
    );
  }
}

const ALARM_NAME = 'tabverse_dropbox_autobackup';

async function autoExportDropboxImpl(accessToken: string) {
  const backupMd5Files = await listDropboxFiles(accessToken, '', (fileName) =>
    fileName.endsWith('.md5.txt'),
  );
  const client = new Dropbox({ accessToken });
  let lastBackupMd5 = '';
  if (backupMd5Files.length > 0) {
    const result = await client.filesDownload({
      path: backupMd5Files[0].path_lower,
    });
    logger.log('dropbox filesDownload returns:', result);
    const fileBlob = (result.result as any).fileBlob;
    lastBackupMd5 = await fileBlob.text().trim();
  }
  exportToDropbox(accessToken, generateNewDropboxBackupFileName('autobackup'));
}

function autoExportDropbox(alarm: chrome.alarms.Alarm) {
  const autoBackupFlag = getSettingItem(SETTING_KEY_DROPBOX_AUTOBACKUP, (v) =>
    v.toLowerCase() === 'true' ? true : false,
  );
  if (autoBackupFlag) {
    const dropboxAccessToken = getSettingItem(
      SETTING_KEY_DROPBOX_ACCESSTOKEN,
      (v) => v,
    );
    if (dropboxAccessToken.length <= 0) {
      logger.info(`autoExportDropbox: dropboxAccessToken is empty, skip.`);
    } else {
      autoExportDropboxImpl(dropboxAccessToken);
    }
  } else {
    logger.info(
      `autoExportDropbox: settings of ${SETTING_KEY_DROPBOX_AUTOBACKUP} is false, skip.`,
    );
  }
}

export async function startAutoExportToDropbox(periodInMinutes: number) {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes });
  logger.info(`Alarm ${ALARM_NAME} created.`);
  chrome.alarms.onAlarm.addListener(autoExportDropbox);
  logger.info(`Alarm ${ALARM_NAME} callback added.`);
}
