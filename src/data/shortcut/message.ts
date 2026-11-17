import {
  BackgroundMsg,
  IAddShortcutFromTabPayload,
  IAddShortcutResponse,
} from '../../message/message';
import { AddShortcutResult, addShortcutFromTab } from './addShortcut';
import { Shortcut, shortcutDisplayName } from './Shortcut';
import { logger } from '../../global';

export type AddShortcutFn = (chromeTabId: number) => Promise<AddShortcutResult>;

export type AddShortcutResponder = (response?: IAddShortcutResponse) => void;

function nameOf(result: AddShortcutResult): string {
  const shortcut: Shortcut | undefined = result.shortcut;
  return shortcut ? shortcutDisplayName(shortcut) : '';
}

/**
 * The worker half of the toolbar popup's "add this tab" button.
 *
 * It is a factory so the test can drive the handler with a fake add and a fake
 * responder, and the worker registers the real one. The response is small on
 * purpose: status and a display name, never the record (which may carry tens
 * of kilobytes of icon bytes).
 */
export function createAddShortcutMessageHandler(
  addFn: AddShortcutFn = addShortcutFromTab,
) {
  return (
    message: { type?: string; payload?: Partial<IAddShortcutFromTabPayload> },
    _sender: chrome.runtime.MessageSender,
    sendResponse: AddShortcutResponder,
  ): boolean => {
    if (message?.type !== BackgroundMsg.AddShortcutFromTab) {
      return false;
    }
    const chromeTabId = Number(message.payload?.chromeTabId);
    void addFn(chromeTabId)
      .then((result) => {
        sendResponse({
          ok: true,
          status: result.status,
          name: nameOf(result),
        });
      })
      .catch((err) => {
        logger.error('shortcut: the popup add failed', err);
        sendResponse({ ok: false, error: 'add failed' });
      });
    // keep the message channel open for the async answer
    return true;
  };
}

export const handleAddShortcutMessage = createAddShortcutMessageHandler();
