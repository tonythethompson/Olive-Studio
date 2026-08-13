# Design Document: Light Mode Theme

## Overview

This design describes the architecture for adding a light mode theme to Olive Studio. The implementation uses CSS custom properties on the document root (`[data-theme="light"]` / `[data-theme="dark"]`) so that all 26+ feature panels inherit the active palette without per-component modifications. A new `preferencesStore` (Zustand + persist) holds the user's theme choice, and an inline `<script>` in `index.html` eliminates flash-of-wrong-theme on load.

## Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────────────┐
│ index.html                                                    │
│  <script> (theme-init) — reads localStorage, sets data-theme │
│           before React mounts                                 │
└──────────────────────────────────────────────────────────────┘
           │ sets <html data-theme="light|dark">
           ▼
┌──────────────────────────────────────────────────────────────┐
│ src/index.css                                                 │
│  @theme { ... }              — dark palette (default)         │
│  [data-theme="light"] { ... } — light palette (override)     │
│  color-scheme: light|dark    — native chrome adaptation       │
│  ::-webkit-scrollbar         — themed scrollbar               │
└──────────────────────────────────────────────────────────────┘
           │ variables cascade into all components
           ▼
┌───────────────────────────────────────────────────────────────┐
│ React application                                              │
│                                                                │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ preferencesStore.ts (zustand + persist)                   │   │
│ │  state: { themePreference: "system" | "light" | "dark" } │   │
│ │  actions: setThemePreference(...)                         │   │
│ └──────────────────────────────┬──────────────────────────┘   │
│                                │                               │
│ ┌──────────────────────────────▼──────────────────────────┐   │
│ │ useThemeEffect() — hook in App.tsx                        │   │
│ │  • Reads preferencesStore                                 │   │
│ │  • Listens to prefers-color-scheme changes                │   │
│ │  • Applies data-theme to <html>                           │   │
│ └─────────────────────────────────────────────────────────┘   │
│                                                                │
│ ┌─────────────────────────────────────────────────────────┐   │
│ │ SettingsMenu.tsx (gear icon in header)                    │   │
│ │  • ThemeToggle with "System" / "Light" / "Dark"          │   │
│ │  • Calls preferencesStore.setThemePreference(...)         │   │
│ └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **First paint (before React):** Inline script in `<head>` reads `localStorage["olive:preferences"]`, extracts `themePreference`, resolves to `"light"` or `"dark"` (consulting `matchMedia` for `"system"`), and sets `document.documentElement.dataset.theme`.
2. **React mount:** `useThemeEffect()` hook hydrates, subscribes to both the store and `matchMedia("(prefers-color-scheme: dark)")` change events, and keeps `data-theme` in sync throughout the session.
3. **User interaction:** `SettingsMenu` → `ThemeToggle` → `preferencesStore.setThemePreference(choice)` → store persists to localStorage → `useThemeEffect` reacts → `data-theme` attribute updates → CSS variables re-resolve → entire UI repaints.

## Components

### 1. Inline Theme Init Script (`index.html`)

A synchronous `<script>` in `<head>` that runs before `<body>` paint:

```typescript
// Inlined directly in index.html (no external module fetch)
(function () {
  const STORAGE_KEY = "olive:preferences";
  const ATTR = "data-theme";

  function getResolved(): "light" | "dark" {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const pref = parsed?.state?.themePreference;
        if (pref === "light" || pref === "dark") return pref;
      }
    } catch { /* corrupted or unavailable — fall through */ }
    // "system" or missing → detect OS
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  const theme = getResolved();
  document.documentElement.setAttribute(ATTR, theme);
  document.documentElement.style.colorScheme = theme;
})();
```

### 2. Preferences Store (`src/lib/stores/preferencesStore.ts`)

```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface PreferencesState {
  themePreference: ThemePreference;
}

interface PreferencesActions {
  setThemePreference: (pref: ThemePreference) => void;
}

type PreferencesStore = PreferencesState & PreferencesActions;

const STORAGE_KEY = "olive:preferences";

export const usePreferencesStore = create<PreferencesStore>()(
  persist(
    (set) => ({
      themePreference: "system",
      setThemePreference: (pref) => set({ themePreference: pref }),
    }),
    { name: STORAGE_KEY },
  ),
);

/**
 * Resolve the effective theme given a preference and OS signal.
 * Pure function — testable without DOM.
 */
export function resolveTheme(
  preference: ThemePreference,
  osDark: boolean,
): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return osDark ? "dark" : "light";
}
```

### 3. Theme Effect Hook (`src/lib/hooks/useThemeEffect.ts`)

```typescript
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
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function apply() {
      const resolved = resolveTheme(themePreference, mq.matches);
      document.documentElement.setAttribute("data-theme", resolved);
      document.documentElement.style.colorScheme = resolved;
    }

    apply();

    // Only subscribe to OS changes when preference is "system"
    if (themePreference === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [themePreference]);
}
```

### 4. CSS Variable Layer (`src/index.css` additions)

Under `@layer base`, after the existing `:root` rule:

```css
@layer base {
  :root {
    color-scheme: dark; /* existing — overridden by JS at runtime */
  }

  [data-theme="light"] {
    color-scheme: light;

    /* Invert the slate scale: high numbers → light green, low numbers → dark */
    --color-slate-950: #f0f5e8;  /* body bg: very light green */
    --color-slate-900: #e4ecda;
    --color-slate-850: #d8e3cc;
    --color-slate-800: #c8d9b8;
    --color-slate-750: #b0c99e;
    --color-slate-700: #94b580;
    --color-slate-600: #6b8a55;
    --color-slate-500: #4d6b3a;
    --color-slate-400: #3a5228;
    --color-slate-300: #1a1f14;  /* body text: near-black */
    --color-slate-200: #2c3422;
    --color-slate-100: #1f2518;
    --color-slate-50:  #141a10;

    /* Accent adjustments for light contrast */
    --color-electric-blue: #5c8020;
    --color-electric-blue-dark: #4a6a18;
    --color-olive: #5c8020;
    --color-olive-dark: #4a6a18;
    --color-emerald-accent: #4d8b35;
    --color-emerald-dark: #3a6b28;
  }

  /* Scrollbar adaptation for light mode */
  [data-theme="light"] ::-webkit-scrollbar-thumb {
    background-color: var(--color-slate-700);
  }
  [data-theme="light"] ::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-slate-600);
  }
}
```

### 5. Settings Menu Component (`src/components/SettingsMenu.tsx`)

```typescript
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
```

### 6. Integration into Application Shell

**App.tsx header area** (web-only mode — where TitleBar returns `null`):
- Add `<SettingsMenu />` to the right side of the top navigation bar.
- Import `useThemeEffect` and call it in `Dashboard` component body.

**TitleBar.tsx** (Tauri desktop mode):
- Insert `<SettingsMenu />` left of the window control buttons within the drag region exclusion zone.

## Interfaces

### PreferencesStore State Interface

```typescript
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

interface PreferencesState {
  themePreference: ThemePreference;
}

interface PreferencesActions {
  setThemePreference: (pref: ThemePreference) => void;
}
```

### localStorage Schema

Key: `"olive:preferences"`

```json
{
  "state": {
    "themePreference": "system" | "light" | "dark"
  },
  "version": 0
}
```

This uses Zustand persist's default format, enabling future versioned migrations.

### resolveTheme Function Signature

```typescript
function resolveTheme(preference: ThemePreference, osDark: boolean): ResolvedTheme;
```

Pure function mapping preference + OS signal → effective theme. Central logic shared between the inline init script and the React hook.

## Data Models

### Theme Preference (Persisted)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `themePreference` | `"system" \| "light" \| "dark"` | `"system"` | User's explicit choice or delegation to OS |

### Resolved Theme (Runtime)

| Value | Meaning |
|-------|---------|
| `"light"` | Light green background, dark text |
| `"dark"` | Current olive-tinted dark palette |

### CSS Variable Mapping (Light Mode)

| CSS Variable | Dark Value | Light Value | Semantic Role |
|---|---|---|---|
| `--color-slate-950` | `#0d0e0a` | `#f0f5e8` | Body background |
| `--color-slate-900` | `#14150f` | `#e4ecda` | Panel surfaces |
| `--color-slate-800` | `#22241a` | `#c8d9b8` | Borders, dividers |
| `--color-slate-700` | `#343625` | `#94b580` | Scrollbar thumb |
| `--color-slate-300` | `#c8c5b8` | `#1a1f14` | Body text |
| `--color-slate-50` | `#f5f3ec` | `#141a10` | Brightest text |
| `--color-electric-blue` | `#8da840` | `#5c8020` | Primary accent |

## Error Handling

| Scenario | Handling |
|----------|----------|
| `localStorage` unavailable (private browsing) | Inline script catches, falls back to `matchMedia` detection. Store uses in-memory fallback (Zustand persist handles this natively). |
| Corrupted `olive:preferences` JSON | `JSON.parse` inside try/catch; fall back to OS preference. |
| `matchMedia` not supported (e.g., SSR) | Default to `"dark"` theme (existing behavior). |
| Unknown `themePreference` value in storage | `resolveTheme` treats any value other than `"light"` or `"dark"` as `"system"`. |
| Browser lacks `color-scheme` support | Visual fallback only — functional theme still applies via CSS variables. Scrollbar styling may not adapt, but core UI remains usable. |

## File Organization

```
src/
  lib/
    stores/
      preferencesStore.ts        ← NEW: Zustand store for theme preference
    hooks/
      useThemeEffect.ts          ← NEW: Effect hook syncing store → DOM
  components/
    SettingsMenu.tsx              ← NEW: Gear icon + dropdown with ThemeToggle

src/index.css                    ← MODIFIED: Add [data-theme="light"] variables
index.html                       ← MODIFIED: Add inline theme-init <script>
src/App.tsx                      ← MODIFIED: Import SettingsMenu + useThemeEffect
src/components/TitleBar.tsx      ← MODIFIED: Add SettingsMenu for Tauri mode
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Acceptance Criteria Testing Prework

**Requirement 1: System Preference Detection**

1.1 WHEN the application loads for the first time (no persisted preference), THE Theme_System SHALL read the OS_Preference via `prefers-color-scheme` and apply the corresponding theme.
  Thoughts: This tests the resolveTheme logic when preference is "system". For any OS dark/light state, with no persisted preference, the resolved theme should match the OS preference. This is a pure function mapping.
  Classification: PROPERTY
  Test Strategy: Generate random OS dark/light boolean values with preference="system" and verify resolveTheme returns matching theme.

1.2 WHILE no manual override is stored, THE Theme_System SHALL reactively update when OS_Preference changes.
  Thoughts: This tests the event listener subscription in useThemeEffect. It requires DOM/event simulation.
  Classification: EXAMPLE
  Test Strategy: Mount hook with preference="system", simulate matchMedia change event, verify data-theme attribute updates.

1.3 THE Theme_System SHALL apply the detected theme within the same render frame as the initial mount.
  Thoughts: This is about timing/performance — the inline script mechanism. Not input-variable.
  Classification: SMOKE
  Test Strategy: Verify inline script sets data-theme before React mounts (integration check).

**Requirement 2: Manual Theme Override**

2.1 WHEN the user selects a theme option, THE Preferences_Store SHALL persist the selection to localStorage.
  Thoughts: For any valid ThemePreference value, calling setThemePreference should result in that value being readable from localStorage. This is a round-trip property.
  Classification: PROPERTY
  Test Strategy: For any ThemePreference, set it in the store and verify localStorage contains it.

2.2 WHEN the user selects "light" or "dark", THE Theme_System SHALL apply the chosen theme regardless of OS_Preference.
  Thoughts: For any explicit preference and any OS state, the resolved theme should equal the preference. This is testable across all combinations.
  Classification: PROPERTY
  Test Strategy: For any (preference in ["light","dark"]) × (osDark in [true,false]), resolveTheme returns the preference.

2.3 WHEN the user selects "system", THE Theme_System SHALL clear the manual override and resume following OS_Preference.
  Thoughts: This is the inverse of 2.2 — when preference is "system", OS wins. Already covered by the resolveTheme property.
  Classification: PROPERTY (merged with 1.1)
  Test Strategy: Already covered by resolveTheme property for "system" preference.

2.4 WHEN the application loads with a persisted manual override, THE Theme_System SHALL apply the stored preference without consulting OS_Preference.
  Thoughts: Same logic as 2.2 but at load time. The inline script uses the same logic. Tested via the resolveTheme property.
  Classification: PROPERTY (merged with 2.2)
  Test Strategy: Covered by resolveTheme property.

**Requirement 3: Theme Persistence Across Sessions**

3.1 THE Preferences_Store SHALL persist the user's theme selection to localStorage under a stable key.
  Thoughts: Equivalent to 2.1 — round-trip to localStorage.
  Classification: PROPERTY (merged with 2.1)
  Test Strategy: Covered by persistence round-trip property.

3.2 WHEN the application initializes, THE Preferences_Store SHALL read the persisted theme preference before the first render.
  Thoughts: This is about initialization timing — the inline script mechanism.
  Classification: SMOKE
  Test Strategy: Verify that on page load with seeded localStorage, data-theme is set before React hydration.

3.3 IF localStorage is unavailable or corrupted, THEN THE Theme_System SHALL fall back to OS_Preference detection without throwing an error.
  Thoughts: For any corrupted or missing localStorage value, the system should not throw and should default to OS-based resolution. We can generate random invalid strings and verify graceful handling.
  Classification: PROPERTY
  Test Strategy: For any arbitrary string in localStorage at the preferences key, resolveTheme (or the inline script parser) should not throw and should return a valid ResolvedTheme.

**Requirement 4: CSS Variable-Based Theming**

4.1 THE CSS_Variable_Layer SHALL define a light mode palette under `[data-theme="light"]`.
  Thoughts: This is a static CSS correctness check — the variables exist in the stylesheet.
  Classification: EXAMPLE
  Test Strategy: Parse computed styles with data-theme="light" and assert all --color-slate-* are defined.

4.2 THE CSS_Variable_Layer SHALL define the dark mode palette under `[data-theme="dark"]`.
  Thoughts: Same as 4.1, for dark.
  Classification: EXAMPLE
  Test Strategy: Parse computed styles with data-theme="dark" and assert all --color-slate-* are defined.

4.3 WHEN the Theme_System activates a theme, it SHALL set `data-theme` on `<html>`.
  Thoughts: For any valid resolved theme value, calling the apply function should set the attribute. This is the core contract.
  Classification: PROPERTY
  Test Strategy: For any ResolvedTheme, invoke the theme application logic, verify document.documentElement.getAttribute("data-theme") equals the theme.

4.4/4.5 color-scheme shall match the active theme.
  Thoughts: Same mechanism as 4.3 — the apply function sets both data-theme and color-scheme in tandem.
  Classification: PROPERTY (merged with 4.3)
  Test Strategy: Covered by the same property — verify color-scheme is set alongside data-theme.

4.6 Accent colors remain legible against both backgrounds.
  Thoughts: This is a contrast check — can be tested by computing contrast ratio from hex values.
  Classification: PROPERTY
  Test Strategy: For each theme, compute contrast ratio between accent and background; assert >= 4.5:1.

**Requirement 5: Light Mode Color Palette**

5.1–5.3 Palette inversion and specific values.
  Thoughts: These are static design checks on CSS values.
  Classification: EXAMPLE
  Test Strategy: Verify specific CSS variable values under [data-theme="light"].

5.4 WCAG AA contrast ratio between body text and background.
  Thoughts: For the defined palette, compute the contrast ratio. This is a fixed pair of values, not input-variable.
  Classification: EXAMPLE
  Test Strategy: Compute relative luminance of --color-slate-300 and --color-slate-950 in light mode, assert ratio >= 4.5:1.

5.5 Border/hover/focus-ring visibility.
  Thoughts: Visual check — can verify contrast of border colors against background.
  Classification: EXAMPLE
  Test Strategy: Verify border-color (slate-700/800) contrast against light background >= 3:1.

**Requirement 6: Settings Menu with Theme Toggle**

6.1 Gear icon in header area.
  Thoughts: This is a UI structure check.
  Classification: EXAMPLE
  Test Strategy: Render App, assert gear icon button is present with aria-label="Settings".

6.2 Dropdown appears on activation.
  Thoughts: This is a UI interaction test.
  Classification: EXAMPLE
  Test Strategy: Click the gear icon, assert menu appears with role="menu".

6.3 Three options presented.
  Thoughts: Static UI structure.
  Classification: EXAMPLE
  Test Strategy: Open menu, assert three menuitem elements with correct labels.

6.4 Active option visually indicated.
  Thoughts: For any active theme preference, the corresponding option should be highlighted.
  Classification: PROPERTY
  Test Strategy: For any ThemePreference value, render the toggle and verify the matching option has the active class/indicator.

6.5 Menu closes after selection.
  Thoughts: For any option selection, menu should close.
  Classification: PROPERTY
  Test Strategy: For any ThemePreference option, click it and verify menu is no longer visible.

6.6 Accessible label.
  Thoughts: Static attribute check.
  Classification: EXAMPLE
  Test Strategy: Assert aria-label="Settings" on the gear button.

**Requirement 7: No Flash of Incorrect Theme**

7.1–7.3 Inline script applies theme before React mounts.
  Thoughts: This is a timing/integration concern, not input-variable.
  Classification: SMOKE
  Test Strategy: Integration test: seed localStorage, load page, verify data-theme is set before #root has children.

**Requirement 8: Scrollbar and Browser Chrome Adaptation**

8.1–8.3 Scrollbar styling and color-scheme.
  Thoughts: CSS structure check + the color-scheme property (already covered by 4.3 property).
  Classification: EXAMPLE
  Test Strategy: Verify scrollbar CSS rules exist under [data-theme="light"] selector.

**Requirement 9: Keyboard Accessibility**

9.1 Gear icon focusable and activatable.
  Thoughts: Standard HTML button behavior — verify via example.
  Classification: EXAMPLE
  Test Strategy: Tab to gear icon, press Enter, verify menu opens.

9.2 Arrow/Tab navigation within menu.
  Thoughts: For any number of options, keyboard navigation should cycle.
  Classification: EXAMPLE
  Test Strategy: Open menu, verify Tab moves focus between options.

9.3 Enter/Space activates selection.
  Thoughts: For any focused option, pressing Enter should apply that theme.
  Classification: PROPERTY (merged with 6.5 — for any option, activation applies the selection)
  Test Strategy: Covered by the "selection applies and closes" property.

9.4 Escape closes and returns focus.
  Thoughts: Specific behavior test.
  Classification: EXAMPLE
  Test Strategy: Open menu, press Escape, verify menu closed and focus on gear icon.

---

### Property Reflection

Reviewing all identified properties for redundancy:

1. **resolveTheme correctness** (from 1.1, 2.2, 2.3, 2.4): These all test the same `resolveTheme` pure function with different preference/OS combinations. **Consolidate into one comprehensive property**: "For any (preference, osDark) pair, resolveTheme returns the correct resolved theme."

2. **Persistence round-trip** (from 2.1, 3.1): Both test that writing to the store and reading from localStorage produce the same value. **Single property** covers both.

3. **Graceful fallback** (from 3.3): Distinct — tests error handling with invalid inputs. Keep.

4. **Theme application sets DOM correctly** (from 4.3, 4.4, 4.5): All test that applying a resolved theme sets `data-theme` and `color-scheme` on `<html>`. **Single property**.

5. **Accent legibility** (from 4.6): Tests contrast ratios. Could be example-based since there are only 2 fixed palettes, but framing as property ("for any defined theme") is valid. Keep, but it's small.

6. **Toggle indicates active option** (from 6.4): UI property — for any preference state, the correct option is highlighted. Keep.

7. **Selection applies and closes** (from 6.5, 9.3): Both test that selecting any option applies and closes the menu. **Single property**.

**Final property set (6 properties):**
1. resolveTheme correctness
2. Persistence round-trip
3. Graceful fallback on corrupted storage
4. Theme application DOM synchronization
5. Toggle active indication
6. Selection applies preference and closes menu

---

### Property 1: resolveTheme Correctness

*For any* `ThemePreference` value and *for any* OS dark-mode boolean, `resolveTheme(preference, osDark)` SHALL return:
- `"light"` when preference is `"light"` (regardless of osDark)
- `"dark"` when preference is `"dark"` (regardless of osDark)
- `"dark"` when preference is `"system"` and osDark is true
- `"light"` when preference is `"system"` and osDark is false

**Validates: Requirements 1.1, 2.2, 2.3, 2.4**

### Property 2: Preference Persistence Round-Trip

*For any* valid `ThemePreference` value (`"system"`, `"light"`, or `"dark"`), setting it via `preferencesStore.setThemePreference(value)` and then reading from `localStorage["olive:preferences"]` SHALL yield a JSON structure containing `state.themePreference === value`.

**Validates: Requirements 2.1, 3.1**

### Property 3: Graceful Fallback on Corrupted Storage

*For any* arbitrary string stored at the `"olive:preferences"` localStorage key (including empty string, invalid JSON, valid JSON with missing/unexpected fields), the theme init logic SHALL NOT throw an error and SHALL return a valid `ResolvedTheme` (`"light"` or `"dark"`).

**Validates: Requirements 3.3**

### Property 4: Theme Application DOM Synchronization

*For any* `ResolvedTheme` value (`"light"` or `"dark"`), applying the theme SHALL set `document.documentElement.getAttribute("data-theme")` to that value AND set `document.documentElement.style.colorScheme` to that same value.

**Validates: Requirements 4.3, 4.4, 4.5, 8.3**

### Property 5: Toggle Active Indication

*For any* `ThemePreference` value that is the current store state, rendering the `SettingsMenu` with the menu open SHALL visually distinguish exactly one option (the matching one) with the active indicator (e.g., accent color class and checkmark).

**Validates: Requirements 6.4**

### Property 6: Selection Applies Preference and Closes Menu

*For any* theme option in the `SettingsMenu`, activating that option (via click, Enter, or Space) SHALL update the store's `themePreference` to the selected value AND close the dropdown menu.

**Validates: Requirements 6.5, 9.3**
