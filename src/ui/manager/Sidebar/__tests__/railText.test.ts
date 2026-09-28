/**
 * The rail label decides both the tooltip and the button's accessible name,
 * and it used to come out empty: the real headers are
 * `<div><Icon/> Live Tabverses</div>`, whose children are an array, and the
 * first version of the helper only accepted a single string child. So the
 * collapsed rail had no tooltip and no accessible name at all.
 */
import { Icon } from '@blueprintjs/core';
import React from 'react';

import { railTextFromHeader } from '../Sidebar';

test('an icon followed by text yields the text', () => {
  const header = React.createElement(
    'div',
    null,
    React.createElement(Icon, { icon: 'panel-table' }),
    ' Live Tabverses',
  );
  expect(railTextFromHeader(header)).toBe('Live Tabverses');
});

test('several text children are joined and whitespace collapsed', () => {
  const header = React.createElement(
    'div',
    null,
    'My ',
    React.createElement('span', null, 'Web'),
    '   Tools',
  );
  expect(railTextFromHeader(header)).toBe('My Web Tools');
});

test('nested elements are walked, including several levels', () => {
  const header = React.createElement(
    'div',
    null,
    React.createElement(
      'span',
      null,
      React.createElement('b', null, 'Saved'),
      ' ',
      React.createElement('i', null, 'Tabverses'),
    ),
  );
  expect(railTextFromHeader(header)).toBe('Saved Tabverses');
});

test('a plain string works', () => {
  expect(railTextFromHeader('Live Tabverses')).toBe('Live Tabverses');
});

test('an icon-only header yields nothing, so no empty tooltip is rendered', () => {
  const header = React.createElement(
    'div',
    null,
    React.createElement(Icon, { icon: 'build' }),
  );
  expect(railTextFromHeader(header)).toBeUndefined();
});

test('empty and non-text content yields nothing', () => {
  expect(railTextFromHeader(null)).toBeUndefined();
  expect(railTextFromHeader(undefined)).toBeUndefined();
  expect(
    railTextFromHeader(React.createElement('div', null, '   ')),
  ).toBeUndefined();
  expect(railTextFromHeader(false)).toBeUndefined();
});
