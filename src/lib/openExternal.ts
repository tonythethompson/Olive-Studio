import { open as shellOpen } from "@tauri-apps/plugin-shell";

/**
 * Opens an external URL in the default browser.
 *
 * - In Tauri desktop: uses the shell plugin (`shell:allow-open`)
 * - In browser/web: falls back to `window.open()`
 *
 * @param url - The URL to open
 * @returns Promise that resolves when the URL is opened
 */
export async function openExternal(url: string): Promise<void> {
  if (typeof window === "undefined") return;

  // Avoid opening dangerous protocols like `javascript:` / `data:`
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
    if (!(["http:", "https:", "mailto:"] as const).includes(parsed.protocol as "http:" | "https:" | "mailto:")) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Unsupported protocol")) throw e;
    throw new Error("Invalid URL");
  }

  // Check if we're running in Tauri
  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) {
    try {
      // Shell plugin open() takes a path/URL string (not `{ url }`)
      await shellOpen(parsed.href);
    } catch (err) {
      console.error("[openExternal] Tauri shell.open failed:", err);
      // Fallback to window.open if Tauri fails
      const win = window.open(parsed.href, "_blank", "noopener,noreferrer");
      if (!win) throw new Error("Browser blocked the popup");
    }
  } else {
    // Browser/web fallback
    const win = window.open(parsed.href, "_blank", "noopener,noreferrer");
    if (!win) throw new Error("Browser blocked the popup");
  }
}

/**
 * Type declaration for Tauri internals (needed for the check above)
 */
declare global {
  interface Window {
    __TAURI_INTERNALS__?: Record<string, unknown>;
  }
}
