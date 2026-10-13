import { expect, test } from 'vitest';

import { invitationFromSearch } from './invitation';

test('the invitation link params are read, code and address together', () => {
  expect(invitationFromSearch('?invite=CODE-1&email=a%40b.c')).toEqual({
    code: 'CODE-1',
    email: 'a@b.c',
  });
});

test('a link with neither param is not an invitation', () => {
  expect(invitationFromSearch('?user=usr_1&tab=devices')).toBeNull();
  expect(invitationFromSearch('')).toBeNull();
});
