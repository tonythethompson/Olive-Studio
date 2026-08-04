import { invoke } from "@tauri-apps/api/core";

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
  // Check if we're running in Tauri
  if (window.__TAURI_INTERNALS__) {
    try {
      await invoke("plugin:shell|open", { url });
    } catch (err) {
      console.error("[openExternal] Tauri shell.open failed:", err);
      // Fallback to window.open if Tauri fails
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } else {
    // Browser/web fallback
    window.open(url, "_blank", "noopener,noreferrer");
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
