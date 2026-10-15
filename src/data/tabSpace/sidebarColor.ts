/**
 * The sidebar's own colours: a fixed, dark palette.
 *
 * The rail is the one surface in the app that carries near-white glyphs
 * (`$color-on-brand`: the logo, the "Other Tabverses" caption, the bottom bar's
 * icons), so the choices are dark on purpose - a light swatch would erase the
 * icons rather than repaint the surface. The contrast is not a comment: every
 * entry has to clear WCAG AA against the glyph colour, and
 * `sidebarColor.test.ts` is what holds that promise, so adding a swatch that
 * does not is a failing test rather than a matter of taste.
 *
 * A hex is stored, not a palette id: a saved tabverse keeps its colour even if
 * the palette is reordered, and the value can arrive from the server, where it
 * is validated back through `resolveSidebarColor`.
 */

export interface SidebarColor {
  /** the stored value */
  hex: string;
  /** the swatch's accessible name and tooltip */
  name: string;
}

export const SIDEBAR_COLORS: SidebarColor[] = [
  { hex: '#54617a', name: 'Slate' },
  { hex: '#3b3f6b', name: 'Indigo' },
  { hex: '#1f4a52', name: 'Deep teal' },
  { hex: '#2c4934', name: 'Forest' },
  { hex: '#5c2b3a', name: 'Wine' },
  { hex: '#472a55', name: 'Plum' },
  { hex: '#4a3a2b', name: 'Coffee' },
  { hex: '#31333c', name: 'Graphite' },
];

/** Today's rail colour, and the colour a tabverse gets without a choice. */
export const DEFAULT_SIDEBAR_COLOR = SIDEBAR_COLORS[0].hex;

export function isSidebarColor(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    SIDEBAR_COLORS.some((color) => color.hex === value)
  );
}

/**
 * A value from storage, the url or the server, or the default when it is not
 * one of ours. A stale or hand-edited colour must paint the rail, not break it.
 */
export function resolveSidebarColor(value: unknown): string {
  return isSidebarColor(value) ? value : DEFAULT_SIDEBAR_COLOR;
}

/** A colour for a new tabverse, when the person asked for one. */
export function randomSidebarColor(): string {
  const index = Math.floor(Math.random() * SIDEBAR_COLORS.length);
  return SIDEBAR_COLORS[index].hex;
}
