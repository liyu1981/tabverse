import {
  SHORTCUT_ORDER_ALPHABETICAL,
  SHORTCUT_ORDER_NEWEST,
  ShortcutOrder,
} from '../../data/shortcut/Shortcut';

/**
 * Where the Launchpad's order lives. Window-local on purpose (localStorage,
 * `useSettingItem`), like the History tool's grouped switch: two devices on one
 * account may reasonably want different orders, and it is not a record.
 */
export const LAUNCHPAD_ORDER_KEY = 'tabverse_launchpad_order';

export function parseLaunchpadOrder(value: string | undefined): ShortcutOrder {
  return value === SHORTCUT_ORDER_NEWEST
    ? SHORTCUT_ORDER_NEWEST
    : SHORTCUT_ORDER_ALPHABETICAL;
}

export function serializeLaunchpadOrder(order: ShortcutOrder): string {
  return order;
}
