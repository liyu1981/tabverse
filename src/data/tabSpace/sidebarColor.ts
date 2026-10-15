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
  // the default, and the brightness the rest are pulled toward: it is the
  // rail's original slate, so it is the one colour that does not move
  { hex: '#54617a', name: 'Slate' },
  { hex: '#494d83', name: 'Indigo' },
  { hex: '#327885', name: 'Deep teal' },
  { hex: '#497956', name: 'Forest' },
  { hex: '#8b4158', name: 'Wine' },
  { hex: '#724389', name: 'Plum' },
  { hex: '#81654b', name: 'Coffee' },
  { hex: '#5c5f70', name: 'Graphite' },
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
