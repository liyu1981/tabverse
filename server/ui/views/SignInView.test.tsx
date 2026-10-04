import { beforeEach, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { SignInView } from './SignInView';
import { setApi, createConsoleApi } from '../data/api';
import { loadMeFx } from '../data/effects';
import { sessionExpired } from '../data/stores/session';

/**
 * The sign-in screen, rendered to markup.
 *
 * `renderToStaticMarkup` is how views are testable here at all (AGENTS.md: no
 * jsdom), and this one is worth rendering because its whole job is order and
 * wording: which way in is offered first, what is between them, and what it says
 * to somebody who has just asked for a link and is waiting for one.
 */

/** The text a reader sees, with markup and the bold taken out. */
function say(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The identity the page reads, put into the real store the real way. */
async function signedOut(me: Record<string, unknown>) {
  setApi(
    createConsoleApi(async () => ({
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify({
          signed_in: false,
          csrf_header: 'X-XSRF-Token',
          providers: [],
          smtp: true,
          ...me,
        }),
    })),
  );
  await loadMeFx();
}

beforeEach(() => {
  sessionExpired();
});

test('the provider buttons come before the address form', async () => {
  await signedOut({ providers: ['github', 'google'] });
  const html = renderToStaticMarkup(<SignInView />);
  const at = (what: string) => html.indexOf(what);
  expect(at('Continue with Google')).toBeGreaterThan(-1);
  expect(at('Continue with GitHub')).toBeGreaterThan(-1);
  // Google first, then GitHub: the order a person is offered them in, which is
  // not the order the server happens to list them in.
  expect(at('Continue with Google')).toBeLessThan(at('Continue with GitHub'));
  // ...and both before the form, which is the fallback.
  expect(at('Continue with GitHub')).toBeLessThan(at('Send sign-in link'));
});

test('each button carries its mark, and a rule with "or" between the two ways in', async () => {
  await signedOut({ providers: ['google', 'github'] });
  const html = renderToStaticMarkup(<SignInView />);
  // Both marks are inline svg, and each is decorative: the button's own text is
  // the name, so a screen reader never has to guess at a path.
  expect((html.match(/<svg/g) ?? []).length).toBe(2);
  expect(
    (html.match(/aria-hidden="true"/g) ?? []).length,
  ).toBeGreaterThanOrEqual(2);
  // The rule is drawn with a pseudo element on each side of the word, so it is
  // one element and the word inside it.
  expect(html).toContain('orRule');
  expect(say(html)).toContain('or');
});

test('with no provider configured there is no rule and no buttons', async () => {
  await signedOut({ providers: [] });
  const html = renderToStaticMarkup(<SignInView />);
  expect(html).not.toContain('Continue with');
  expect(html).not.toContain('orRule');
  expect(html).not.toContain('<svg');
  // The address form is the whole screen, and still says what it does.
  expect(html).toContain('Send sign-in link');
  expect(say(html)).toContain('link that works once');
});

test('a provider this build has no mark for is still offered', async () => {
  // A half-known provider is still a way in. It keeps its place at the end and
  // gets a label but no mark, which is better than a wrong mark or no button.
  await signedOut({ providers: ['github', 'somethingnew'] });
  const html = renderToStaticMarkup(<SignInView />);
  expect(say(html)).toContain('Continue with somethingnew');
  expect((html.match(/<svg/g) ?? []).length).toBe(1);
  expect(html.indexOf('Continue with somethingnew')).toBeGreaterThan(
    html.indexOf('Continue with GitHub'),
  );
});

test('nothing on the screen claims mail is unconfigured when it is', async () => {
  // The old view told every visitor that no mail server was configured, which is
  // false on every deployment that has one - and the person who most needs to
  // know is the one who has just asked for a link and is waiting for it.
  await signedOut({ providers: [], smtp: true });
  expect(say(renderToStaticMarkup(<SignInView />))).not.toContain(
    'no mail server',
  );
});

test('the mark slot is the same size with or without a mark', async () => {
  // Otherwise a provider without one has its label in a different place and the
  // stack stops lining up.
  await signedOut({ providers: ['github', 'somethingnew'] });
  const html = renderToStaticMarkup(<SignInView />);
  expect((html.match(/socialMark/g) ?? []).length).toBe(2);
});
