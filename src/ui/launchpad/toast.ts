import { Intent, Toaster } from '@blueprintjs/core';

import { AddShortcutResult } from '../../data/shortcut/addShortcut';
import { shortcutDisplayName } from '../../data/shortcut/Shortcut';
import { t } from '../../i18n';

/**
 * One toast per add, from whichever of the four entry points made it.
 *
 * The "already" case is the one the review asked for: the buttons stay
 * enabled and show a tick, so a second click has to say why nothing changed
 * rather than silently doing nothing.
 */
export function showAddShortcutResult(
  toaster: Toaster,
  result: AddShortcutResult,
): void {
  const name = result.shortcut ? shortcutDisplayName(result.shortcut) : '';
  if (result.status === 'created') {
    toaster.show({
      intent: Intent.SUCCESS,
      message: t('launchpadAddedToast', [name]),
    });
    return;
  }
  if (result.status === 'existing') {
    toaster.show({
      intent: Intent.WARNING,
      message: t('launchpadAlreadyToast', [name]),
    });
    return;
  }
  toaster.show({
    intent: Intent.DANGER,
    message: t('launchpadUnreadableToast'),
  });
}
