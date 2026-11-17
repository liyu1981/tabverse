import { describe, expect, test } from 'vitest';

import { createAddShortcutMessageHandler } from '../message';
import { BackgroundMsg, IAddShortcutResponse } from '../../../message/message';
import { Shortcut } from '../Shortcut';

function shortcut(name: string): Shortcut {
  return {
    id: 's1',
    name,
    url: 'https://example.com/',
    iconDataUrl: 'data:image/png;base64,AAA',
    iconUrl: '',
    favIconUrl: '',
    createdAt: 1,
    updatedAt: 1,
    version: 12,
  };
}

const sender = {} as chrome.runtime.MessageSender;

describe('the worker add handler', () => {
  test('answers with the status and the name, never the bytes', async () => {
    let answered: IAddShortcutResponse | undefined;
    const handler = createAddShortcutMessageHandler(async () => ({
      status: 'created',
      shortcut: shortcut('Figma'),
    }));
    const handled = handler(
      {
        type: BackgroundMsg.AddShortcutFromTab,
        payload: { chromeTabId: 7 },
      },
      sender,
      (response) => {
        answered = response;
      },
    );
    expect(handled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answered).toMatchObject({
      ok: true,
      status: 'created',
      name: 'Figma',
    });
    expect(JSON.stringify(answered)).not.toContain('base64');
  });

  test('passes the tab id through, and says existing when it was saved', async () => {
    const seen: number[] = [];
    let answered: IAddShortcutResponse | undefined;
    const handler = createAddShortcutMessageHandler(async (id) => {
      seen.push(id);
      return { status: 'existing', shortcut: shortcut('Figma') };
    });
    handler(
      {
        type: BackgroundMsg.AddShortcutFromTab,
        payload: { chromeTabId: 42 },
      },
      sender,
      (response) => {
        answered = response;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([42]);
    expect(answered?.status).toBe('existing');
  });

  test("another message is not this handler's", () => {
    const handler = createAddShortcutMessageHandler(async () => ({
      status: 'created',
    }));
    expect(
      handler(
        { type: 'something_else', payload: { chromeTabId: 1 } },
        sender,
        () => undefined,
      ),
    ).toBe(false);
  });

  test('a failed add answers ok false rather than staying silent', async () => {
    let answered: IAddShortcutResponse | undefined;
    const handler = createAddShortcutMessageHandler(async () => {
      throw new Error('boom');
    });
    handler(
      {
        type: BackgroundMsg.AddShortcutFromTab,
        payload: { chromeTabId: 7 },
      },
      sender,
      (response) => {
        answered = response;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answered?.ok).toBe(false);
  });
});
