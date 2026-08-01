import { useEffect, useState, type ReactNode } from "react";
import { Monitor } from "lucide-react";

/** Below this width the recipe builder is not supported (phone / very narrow). */
export const DESKTOP_MIN_WIDTH_PX = 700;

/** At and above this width the full sidebar + horizontal graph shell is used. */
export const WIDE_SHELL_MIN_WIDTH_PX = 900;

interface DesktopMinimumViewportProps {
  children: ReactNode;
  minWidthPx?: number;
}

/**
 * Shows a desktop-only empty state when the viewport is narrower than the
 * supported layout. Between minWidth and the wide shell breakpoint, the app
 * rearranges (icon rail, stacked graph, assistant overlay).
 */
export function DesktopMinimumViewport({
  children,
  minWidthPx = DESKTOP_MIN_WIDTH_PX,
}: DesktopMinimumViewportProps) {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia(`(max-width: ${minWidthPx - 1}px)`);
    const sync = () => setIsNarrow(media.matches);
    sync();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }

    media.addListener(sync);
    return () => media.removeListener(sync);
  }, [minWidthPx]);

  if (!isNarrow) return children;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-300">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-electric-blue">
        <Monitor className="h-7 w-7" aria-hidden />
      </div>
      <h1 className="text-lg font-semibold text-slate-100">Desktop layout required</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
        Olive Studio needs a window about {minWidthPx}px wide or wider. From {minWidthPx}–
        {WIDE_SHELL_MIN_WIDTH_PX}
        px the shell rearranges for a narrow desktop; below {minWidthPx}px it is not supported.
      </p>
      <p className="mt-4 text-[11px] font-mono text-slate-400">Current layout: phone / too narrow</p>
    </div>
  );
}
