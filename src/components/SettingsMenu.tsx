import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Monitor, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePreferencesStore, type ThemePreference } from "@/lib/stores/preferencesStore";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: typeof Monitor }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    },
    [],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
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
          aria-label="Theme selection"
          className={cn(
            "absolute right-0 top-full mt-1 z-50 min-w-[160px]",
            "rounded border border-slate-700 bg-slate-900 shadow-lg py-1",
          )}
          onKeyDown={handleKeyDown}
        >
          <div className="px-2 py-1 text-[11px] text-slate-500 uppercase tracking-wider">
            Theme
          </div>
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitem"
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
        </div>
      )}
    </div>
  );
}
