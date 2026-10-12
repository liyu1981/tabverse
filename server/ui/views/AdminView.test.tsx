import { expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { AdminView } from './AdminView';

/**
 * The operator's page, at /console/admin.
 *
 * It is a page of its own rather than a tab of the account console, so what
 * this pins is that it has a rail of its own: the accounts, and who may
 * register. The sections themselves are checked by their own files.
 */
test('the admin page has its own rail: accounts and registration invites', () => {
  const html = renderToStaticMarkup(<AdminView />);
  expect(html).toContain('Admin');
  expect(html).toContain('Accounts');
  expect(html).toContain('Registration invites');
});
