import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Monitor, Sun, Moon, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferencesStore, type ThemePreference } from "@/lib/stores/preferencesStore";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof Monitor }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

interface SettingsMenuProps {
  /** Replays the guided tour. The tour marks itself seen, so this is the anytime entry point. */
  onTakeTour?: () => void;
}

/**
 * Renders a settings menu for selecting the theme and optionally starting the product tour.
 *
 * @param onTakeTour - Callback invoked when the user selects “Take the tour”
 */
export function SettingsMenu({ onTakeTour }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const themePreference = usePreferencesStore((s) => s.themePreference);
  const setThemePreference = usePreferencesStore((s) => s.setThemePreference);

  const handleSelect = useCallback(
    (value: ThemePreference) => {
      setThemePreference(value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [setThemePreference],
  );

  const handleTakeTour = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
    onTakeTour?.();
  }, [onTakeTour]);

  // Focus first menu item when menu opens
  useEffect(() => {
    if (open) {
      // Defer to next frame so the menu is rendered before focusing
      requestAnimationFrame(() => {
        itemRefs.current[0]?.focus();
      });
    }
  }, [open]);

  // Keyboard navigation within menu
  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

      switch (e.key) {
        case "Escape":
          setOpen(false);
          triggerRef.current?.focus();
          e.preventDefault();
          break;
        case "ArrowDown": {
          e.preventDefault();
          const next = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
          items[next]?.focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
          items[prev]?.focus();
          break;
        }
        case "Home":
          e.preventDefault();
          items[0]?.focus();
          break;
        case "End":
          e.preventDefault();
          items[items.length - 1]?.focus();
          break;
      }
    },
    [],
  );

  // Close on outside pointer — defer focus restoration so browser default
  // focus processing on the target element completes first.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        // Defer focus restoration so the browser can process default focus on the
        // clicked element first — prevents overriding focus on a focusable sibling.
        requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body) {
            triggerRef.current?.focus();
          }
        });
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Settings"
        aria-expanded={open}
        aria-haspopup="true"
        data-tour="settings"
        className={cn(
          "p-1.5 rounded text-slate-500 hover:text-slate-200 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <Settings className="h-4 w-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Settings"
          className={cn(
            "absolute right-0 top-full mt-1 z-50 min-w-[160px]",
            "rounded border border-slate-700 bg-slate-900 shadow-lg py-1",
          )}
          onKeyDown={handleMenuKeyDown}
        >
          <div className="px-2 py-1 text-[11px] text-slate-500 uppercase tracking-wider">
            Theme
          </div>
          {THEME_OPTIONS.map(({ value, label, Icon }, index) => (
            <button
              key={value}
              ref={(el) => { itemRefs.current[index] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={value === themePreference}
              tabIndex={-1}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
                value === themePreference
                  ? "text-electric-blue"
                  : "text-slate-300",
              )}
              onClick={() => handleSelect(value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelect(value);
                }
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
              {value === themePreference && (
                <span className="ml-auto text-[10px]">✓</span>
              )}
            </button>
          ))}
          {onTakeTour && (
            <>
              <div className="my-1 border-t border-slate-700" role="separator" />
              <button
                ref={(el) => { itemRefs.current[THEME_OPTIONS.length] = el; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors text-slate-300",
                  "hover:bg-slate-800 focus-visible:bg-slate-800 focus-visible:outline-none",
                )}
                onClick={handleTakeTour}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleTakeTour();
                  }
                }}
              >
                <GraduationCap className="h-3.5 w-3.5" />
                <span>Take the tour</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
