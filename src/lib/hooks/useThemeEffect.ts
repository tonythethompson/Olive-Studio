import { useEffect } from "react";
import { usePreferencesStore, resolveTheme } from "@/lib/stores/preferencesStore";

/**
 * Synchronizes the `data-theme` attribute on <html> with the
 * Preferences Store and OS color-scheme changes.
 *
 * Must be called once at the app root (e.g., App.tsx or Dashboard).
 */
export function useThemeEffect(): void {
  const themePreference = usePreferencesStore((s) => s.themePreference);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof document === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function apply() {
      const resolved = resolveTheme(themePreference, mq.matches);
      document.documentElement.setAttribute("data-theme", resolved);
      document.documentElement.style.colorScheme = resolved;
    }

    apply();

    // Only subscribe to OS changes when preference is "system"
    if (themePreference === "system") {
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", apply);
        return () => mq.removeEventListener("change", apply);
      }
      if (typeof mq.addListener === "function") {
        mq.addListener(apply);
        return () => mq.removeListener(apply);
      }
    }
  }, [themePreference]);
}
