import { WIDE_SHELL_MIN_WIDTH_PX } from "@/components/DesktopMinimumViewport";

/**
 * Grows the window toward the wide shell when Take the tour is pressed
 * from a phone-narrow viewport and the display has room.
 *
 * @returns true when innerWidth is at least {@link WIDE_SHELL_MIN_WIDTH_PX}
 */
export async function ensureDesktopTourViewport(): Promise<boolean> {
  if (window.innerWidth >= WIDE_SHELL_MIN_WIDTH_PX) return true;
  if (window.screen.availWidth < WIDE_SHELL_MIN_WIDTH_PX) return false;

  const targetW = Math.min(
    Math.max(WIDE_SHELL_MIN_WIDTH_PX, window.innerWidth),
    window.screen.availWidth,
  );
  const targetH = Math.min(Math.max(window.innerHeight, 600), window.screen.availHeight);

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await getCurrentWindow().setSize(new LogicalSize(targetW, targetH));
  } catch {
    try {
      window.resizeTo(targetW, targetH);
    } catch {
      return false;
    }
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  return window.innerWidth >= WIDE_SHELL_MIN_WIDTH_PX;
}
