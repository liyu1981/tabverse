/**
 * The sidebar colour palette (`src/data/tabSpace/sidebarColor.ts`).
 *
 * What this pins: every offered colour is legible under the near-white glyphs
 * the rail draws (`$color-on-brand`), a value that is not ours resolves to the
 * default rather than painting an unknown colour, and a rolled colour is always
 * one of the choices.
 */
import { expect, test } from 'vitest';

import {
  DEFAULT_SIDEBAR_COLOR,
  SIDEBAR_COLORS,
  isSidebarColor,
  randomSidebarColor,
  resolveSidebarColor,
} from '../sidebarColor';

/** The rail's glyph colour (`$color-on-brand` in global.scss). */
const ON_BRAND = '#f4f6fb';

/** WCAG relative luminance, so the dark-palette rule is a test, not a comment. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (hi + 0.05) / (lo + 0.05);
}

test('every choice clears WCAG AA against the rail glyphs', () => {
  for (const color of SIDEBAR_COLORS) {
    expect(contrastRatio(color.hex, ON_BRAND)).toBeGreaterThanOrEqual(4.5);
  }
});

test('every choice says what it is, and the default is one of them', () => {
  for (const color of SIDEBAR_COLORS) {
    expect(color.name.length).toBeGreaterThan(0);
  }
  expect(isSidebarColor(DEFAULT_SIDEBAR_COLOR)).toBe(true);
});

test('a value that is not ours resolves to the default', () => {
  expect(resolveSidebarColor('#724389')).toBe('#724389');
  expect(resolveSidebarColor(undefined)).toBe(DEFAULT_SIDEBAR_COLOR);
  expect(resolveSidebarColor('chartreuse')).toBe(DEFAULT_SIDEBAR_COLOR);
  expect(resolveSidebarColor(42)).toBe(DEFAULT_SIDEBAR_COLOR);
});

test('a rolled colour is always one of the choices', () => {
  for (let i = 0; i < 50; i++) {
    expect(isSidebarColor(randomSidebarColor())).toBe(true);
  }
});
