import { useEffect, useState, type ReactNode } from "react";
import { Monitor } from "lucide-react";

/** Below this width the recipe builder is not supported (very narrow viewports). */
export const DESKTOP_MIN_WIDTH_PX = 320;

/** At and above this width the full sidebar + horizontal graph shell is used. */
export const WIDE_SHELL_MIN_WIDTH_PX = 900;

interface DesktopMinimumViewportProps {
  children: ReactNode;
  minWidthPx?: number;
}

/**
 * Displays child content at supported viewport widths and a desktop-required message on narrower screens.
 *
 * @param children - Content to display when the viewport meets the minimum width
 * @param minWidthPx - Minimum viewport width required to display the content
 * @returns The child content or a desktop-required empty state
 */
export function DesktopMinimumViewport({
  children,
  minWidthPx = DESKTOP_MIN_WIDTH_PX,
}: DesktopMinimumViewportProps) {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${minWidthPx - 1}px)`).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${minWidthPx - 1}px)`);
    const sync = () => setIsNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [minWidthPx]);

  if (!isNarrow) return children;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-slate-950 px-6 text-center text-slate-300">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-electric-blue">
        <Monitor className="h-7 w-7" aria-hidden />
      </div>
      <h1 className="text-lg font-semibold text-slate-100">Viewport too narrow</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
        Olive Studio needs a viewport at least {minWidthPx}px wide.
      </p>
    </div>
  );
}
