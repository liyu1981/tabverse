/**
 * The AI chat's body (static markup, AGENTS.md: no browser).
 *
 * What this pins: the three states that are not a conversation (not read yet,
 * no model, model switched off) say so instead of drawing an empty chat, a
 * conversation is drawn as a question and an answer, a failed answer shows the
 * reason, the answer's stats are on it, and the context window is shown with
 * numbers when the browser reports them and honestly when it does not.
 */
import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { newChatMessage } from '../../../../data/aiChat/AiChat';
import { ChatStats, ChatView, contextLabel } from '../ChatPanel';

const view = (over: Partial<React.ComponentProps<typeof ChatView>> = {}) =>
  renderToStaticMarkup(
    <ChatView
      messages={[]}
      draft=""
      streaming={false}
      usage={{ used: null, total: null }}
      error={null}
      availability="ready"
      progress={null}
      enabled={true}
      loaded={true}
      onDraftChange={() => undefined}
      onSend={() => undefined}
      onStop={() => undefined}
      onClear={() => undefined}
      onCopy={() => undefined}
      onRegenerate={() => undefined}
      {...over}
    />,
  );

test('before the stored conversation is read, a spinner and no chat', () => {
  const markup = view({ loaded: false });
  expect(markup).toContain('bp6-spinner');
  expect(markup).not.toContain('Ask Chrome');
});

test('no on-device model says so, and offers no composer', () => {
  const markup = view({ availability: 'absent' });
  expect(markup).toContain('No on-device model');
  expect(markup).not.toContain('<textarea');
});

test('the model switched off says so, with where to turn it back on', () => {
  const markup = view({ enabled: false });
  expect(markup).toContain('The on-device model is off');
  expect(markup).toContain('Settings');
  expect(markup).not.toContain('<textarea');
});

test('an empty conversation explains itself and offers the composer', () => {
  const markup = view();
  expect(markup).toContain('Ask Chrome');
  expect(markup).toContain('<textarea');
  expect(markup).toContain('Send');
});

test('a question and an answer are drawn as two turns', () => {
  const markup = view({
    messages: [
      newChatMessage('user', 'the question'),
      {
        ...newChatMessage('assistant', 'the answer'),
        outputTokens: 3,
        tokensPerSecond: 30,
        durationMs: 100,
      },
    ],
  });
  expect(markup).toContain('the question');
  expect(markup).toContain('the answer');
  expect(markup).toContain('30.0 tok/s');
  expect(markup).toContain('100 ms');
});

test('an answer is rendered as markdown, not as its source', () => {
  const markup = view({
    messages: [newChatMessage('assistant', '# Title\n\n- a\n- b\n\n`code`')],
  });
  expect(markup).toContain('<h1>Title</h1>');
  expect(markup).toContain('<li>a</li>');
  expect(markup).toContain('<code>code</code>');
  // the markers themselves are gone
  expect(markup).not.toContain('- a');
});

test('a dangerous link in an answer is not a link', () => {
  const markup = view({
    messages: [newChatMessage('assistant', '[x](javascript:alert(1))')],
  });
  expect(markup).not.toContain('javascript:');
});

test('a compaction summary is shown as a note, not a bubble', () => {
  const markup = view({
    messages: [
      { ...newChatMessage('system', 'the summary'), compacted: true },
      newChatMessage('user', 'q'),
      newChatMessage('assistant', 'a'),
    ],
  });
  expect(markup).toContain('Earlier conversation summarized');
  expect(markup).toContain('the summary');
});

test('every answer can be copied, and only the newest regenerated', () => {
  const markup = view({
    messages: [
      newChatMessage('user', 'q1'),
      newChatMessage('assistant', 'a1'),
      newChatMessage('user', 'q2'),
      newChatMessage('assistant', 'a2'),
    ],
  });
  expect((markup.match(/aria-label="Copy the answer"/g) ?? []).length).toBe(2);
  expect(
    (markup.match(/aria-label="Regenerate the answer"/g) ?? []).length,
  ).toBe(1);
});

test('a failed answer shows the reason instead of text', () => {
  const markup = view({
    messages: [
      { ...newChatMessage('assistant', ''), error: 'model went away' },
    ],
  });
  expect(markup).toContain('model went away');
  // it can be asked again even though it failed, and there is nothing to copy
  expect(markup).toContain('Regenerate the answer');
  expect(markup).not.toContain('Copy the answer');
});

test('while streaming the composer offers Stop, not Send', () => {
  const markup = view({ streaming: true, draft: 'typed' });
  expect(markup).toContain('Stop');
  expect(markup).not.toContain('>Send<');
});

describe('the context window', () => {
  test('reports the numbers the browser gave', () => {
    const markup = renderToStaticMarkup(
      <ChatStats usage={{ used: 40, total: 100 }} />,
    );
    expect(markup).toContain('40 / 100 tokens');
    expect(markup).toContain('progressbar');
  });

  test('a browser that reports nothing says so rather than showing 0/0', () => {
    expect(contextLabel({ used: null, total: null })).toContain(
      'does not report',
    );
  });
});
