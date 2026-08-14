/**
 * Viewport-clamped positioning for popover menus anchored below a UI element.
 * Shared by feature panels that render fixed-position dropdown menus.
 */

export type MenuPos = { top: number; left: number };

/**
 * Compute a menu position anchored below `anchor`, clamped horizontally so a
 * 22rem-wide menu (or the viewport minus margins, whichever is smaller) stays
 * fully visible.
 */
export function computeAnchoredMenuPos(anchor: { left: number; bottom: number }): MenuPos {
  const menuWidth = Math.min(window.innerWidth - 32, 22 * 16);
  const left = Math.min(Math.max(16, anchor.left), window.innerWidth - menuWidth - 16);
  return { top: anchor.bottom + 8, left };
}
