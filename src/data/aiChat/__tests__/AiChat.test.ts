/**
 * The chat's model and its seeding rules (`src/data/aiChat/AiChat.ts`).
 */
import { describe, expect, test } from 'vitest';

import {
  CHAT_CONTEXT_MESSAGES,
  chatInitialPrompts,
  isChatMessage,
  newChatMessage,
  promptTextFor,
  summaryTranscript,
} from '../AiChat';

test('a new message carries its role, text and a fresh id', () => {
  const message = newChatMessage('user', 'hello', 123);
  expect(message.role).toBe('user');
  expect(message.content).toBe('hello');
  expect(message.at).toBe(123);
  expect(message.id.length).toBeGreaterThan(0);
  expect(newChatMessage('user', 'x').id).not.toBe(message.id);
});

test('a user turn with an attached page assembles a data-labelled prompt', () => {
  const message = newChatMessage('user', 'what is this?', 1, {
    title: 'A Page',
    url: 'https://example.com/a',
    markdown: '# Heading\n\nbody',
  });
  const prompt = promptTextFor(message);
  expect(prompt).toContain('DATA');
  expect(prompt).toContain('Page title: A Page');
  expect(prompt).toContain('Page url: https://example.com/a');
  expect(prompt).toContain('# Heading');
  // the question comes last, after the block
  expect(prompt.trimEnd().endsWith('what is this?')).toBe(true);
});

test('a turn with no attached page is its own text', () => {
  expect(promptTextFor(newChatMessage('user', 'hi'))).toBe('hi');
  expect(promptTextFor(newChatMessage('assistant', 'hi'))).toBe('hi');
});

test('seeding rebuilds an attached page into the prompt', () => {
  const message = newChatMessage('user', 'q', 1, {
    title: 'T',
    markdown: 'body',
  });
  expect(chatInitialPrompts([message])).toEqual([
    { role: 'user', content: promptTextFor(message) },
  ]);
});

test('a message with a malformed attached page is dropped', () => {
  const withContext = newChatMessage('user', 'q', 1, {
    title: 'T',
    markdown: 'body',
  });
  expect(isChatMessage(withContext)).toBe(true);
  expect(isChatMessage({ ...withContext, context: { title: 'T' } })).toBe(
    false,
  );
});

test('seeding keeps the tail and drops empty and failed turns', () => {
  const messages = [
    newChatMessage('user', 'one'),
    newChatMessage('assistant', 'two'),
    newChatMessage('assistant', ''), // an answer still streaming, or never came
    { ...newChatMessage('assistant', 'boom'), error: 'failed' },
    newChatMessage('user', 'three'),
  ];
  expect(chatInitialPrompts(messages)).toEqual([
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
  ]);
});

test('seeding is capped at the most recent messages', () => {
  const messages = Array.from({ length: CHAT_CONTEXT_MESSAGES + 5 }, (_, i) =>
    newChatMessage(i % 2 === 0 ? 'user' : 'assistant', `m${i}`),
  );
  const seeded = chatInitialPrompts(messages);
  expect(seeded).toHaveLength(CHAT_CONTEXT_MESSAGES);
  expect(seeded[seeded.length - 1].content).toBe(`m${messages.length - 1}`);
});

test('a compaction summary is seeded as a system turn', () => {
  const messages = [
    { ...newChatMessage('system', 'earlier summary'), compacted: true },
    newChatMessage('user', 'a'),
    newChatMessage('assistant', 'b'),
  ];
  expect(chatInitialPrompts(messages)).toEqual([
    { role: 'system', content: 'earlier summary' },
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
  ]);
});

test('a value is kept only if it is shaped like a message', () => {
  expect(isChatMessage(newChatMessage('assistant', 'ok'))).toBe(true);
  expect(isChatMessage({ id: 'x', role: 'system', content: '', at: 1 })).toBe(
    true,
  );
  expect(isChatMessage({ id: 'x', role: 'tool', content: '', at: 1 })).toBe(
    false,
  );
  expect(isChatMessage({ id: 'x', role: 'user', at: 1 })).toBe(false);
  expect(isChatMessage(null)).toBe(false);
  expect(isChatMessage('nope')).toBe(false);
});

describe('the summarizer transcript', () => {
  test('labels the roles, in order', () => {
    expect(
      summaryTranscript([
        newChatMessage('user', 'q'),
        newChatMessage('assistant', 'a'),
        newChatMessage('system', 's'),
      ]),
    ).toBe('User: q\n\nAssistant: a\n\nSummary so far: s');
  });

  test('is capped to its newest end when it is too long', () => {
    const clamped = summaryTranscript(
      [newChatMessage('user', 'x'.repeat(50))],
      10,
    );
    expect(clamped.startsWith('…')).toBe(true);
    expect(clamped.length).toBe(11);
  });
});
