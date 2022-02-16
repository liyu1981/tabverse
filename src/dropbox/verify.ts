import { Dropbox } from 'dropbox';
import { logger } from '../global';

export enum VerifyStatus {
  NotYetPerformed = 0,
  Verifying = 1,
  Failed = 2,
  Succeeded = 3,
}

export async function verifyDropboxAccessToken(
  accessToken: string,
  onStatusChangedFn: (status: VerifyStatus) => void,
  onSaveAccessTokenFn: (accessToken: string) => void,
) {
  if (!accessToken || accessToken.length <= 0) {
    return;
  }
  onStatusChangedFn(VerifyStatus.Verifying);
  const client = new Dropbox({ accessToken });
  try {
    const result = await client.checkUser({ query: 'tabverse' });
    // console.log('result', result);
    if (result.result.result === 'tabverse') {
      try {
        const result2 = await client.filesListFolder({ path: '' });
        onStatusChangedFn(VerifyStatus.Succeeded);
        // if it is validated, then we call the saver
        onSaveAccessTokenFn(accessToken);
      } catch (err) {
        logger.info(
          'dropbox access token is not valid because filesListFolder throw exception',
        );
        onStatusChangedFn(VerifyStatus.Failed);
      }
    } else {
      logger.info('dropbox access token is not valid because checkUser failed');
      onStatusChangedFn(VerifyStatus.Failed);
    }
  } catch (e) {
    logger.info(
      'dropbox access token is not valid because checkUser throw exception',
    );
    onStatusChangedFn(VerifyStatus.Failed);
  }
}
