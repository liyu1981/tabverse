import { debounce } from 'lodash';
import { getNewId } from '../data/common';
import { saveSession } from '../data/chromeSession/sessionSaver';

export function monitorChromeTabChanges(debounceTime: number) {
  const tag = getNewId();
  const sessionCreatedTime = Date.now();
  const commonResponder = debounce(() => {
    saveSession(tag, sessionCreatedTime);
  }, debounceTime);

  chrome.tabs.onAttached.addListener(commonResponder);
  chrome.tabs.onCreated.addListener(commonResponder);
  chrome.tabs.onDetached.addListener(commonResponder);
  chrome.tabs.onMoved.addListener(commonResponder);
  chrome.tabs.onReplaced.addListener(commonResponder);
  chrome.tabs.onRemoved.addListener(commonResponder);
  chrome.tabs.onUpdated.addListener(commonResponder);
  chrome.windows.onCreated.addListener(commonResponder);
  chrome.windows.onRemoved.addListener(commonResponder);
}
