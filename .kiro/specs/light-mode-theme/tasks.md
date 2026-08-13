# Implementation Plan: Light Mode Theme

## Overview

Add a light mode theme to Olive Studio using CSS custom properties, a new Zustand preferences store, and a settings menu. The implementation uses a `[data-theme]` attribute on `<html>` driven by a flash-free inline init script, a reactive hook, and a gear-icon dropdown. All 26+ feature panels inherit the palette automatically via CSS variable cascading.

## Tasks

- [x] 1. Create preferences store and resolveTheme utility
  - [x] 1.1 Create `src/lib/stores/preferencesStore.ts` with Zustand + persist
    - Define `ThemePreference` (`"system" | "light" | "dark"`) and `ResolvedTheme` types
    - Create the `usePreferencesStore` store with `themePreference` state and `setThemePreference` action
    - Use Zustand `persist` middleware with key `"olive:preferences"`
    - Export the pure `resolveTheme(preference, osDark)` function
    - _Requirements: 2.1, 3.1, 3.2, 3.3_

  - [ ]* 1.2 Write property tests for `resolveTheme` (Property 1: resolveTheme correctness)
    - **Property 1: resolveTheme correctness**
    - For any `ThemePreference` and any OS dark boolean, verify resolveTheme returns the correct resolved theme
    - Test all combinations: "light" ignores OS, "dark" ignores OS, "system" defers to OS
    - **Validates: Requirements 1.1, 2.2, 2.3, 2.4**

  - [ ]* 1.3 Write property test for preference persistence round-trip (Property 2)
    - **Property 2: Preference persistence round-trip**
    - For any valid `ThemePreference`, calling `setThemePreference(value)` then reading `localStorage["olive:preferences"]` yields `state.themePreference === value`
    - **Validates: Requirements 2.1, 3.1**

  - [ ]* 1.4 Write property test for corrupted storage fallback (Property 3)
    - **Property 3: Graceful fallback on corrupted storage**
    - For any arbitrary string stored at `"olive:preferences"` key, the theme init parser does not throw and returns a valid `ResolvedTheme`
    - **Validates: Requirements 3.3**

- [x] 2. Create the useThemeEffect hook
  - [x] 2.1 Create `src/lib/hooks/useThemeEffect.ts`
    - Import `usePreferencesStore` and `resolveTheme`
    - Subscribe to `themePreference` state and `matchMedia("(prefers-color-scheme: dark)")` changes
    - Apply `data-theme` and `color-scheme` to `document.documentElement` on preference or OS change
    - Only attach the `matchMedia` listener when preference is `"system"`
    - Clean up event listener on unmount/preference change
    - _Requirements: 1.1, 1.2, 4.3, 4.4, 4.5, 8.3_

  - [ ]* 2.2 Write property test for DOM synchronization (Property 4)
    - **Property 4: Theme application DOM synchronization**
    - For any `ResolvedTheme`, applying the theme sets `document.documentElement.getAttribute("data-theme")` and `document.documentElement.style.colorScheme` to that value
    - **Validates: Requirements 4.3, 4.4, 4.5, 8.3**

- [x] 3. Add CSS variable layer for light mode
  - [x] 3.1 Add `[data-theme="light"]` block in `src/index.css`
    - Insert `[data-theme="light"]` rule inside `@layer base` after the existing `:root` rule
    - Set `color-scheme: light`
    - Invert the `--color-slate-*` scale (950 = light green body bg, 300 = near-black body text)
    - Adjust accent colors (`--color-electric-blue`, `--color-olive`, `--color-emerald-accent`) for light-bg contrast
    - Add scrollbar thumb/hover overrides under `[data-theme="light"] ::-webkit-scrollbar-thumb`
    - _Requirements: 4.1, 4.4, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 8.1_

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create the SettingsMenu component
  - [x] 5.1 Create `src/components/SettingsMenu.tsx`
    - Render a gear icon button (`<Settings>` from lucide-react) with `aria-label="Settings"`
    - Toggle a dropdown menu with `role="menu"` and `aria-label="Theme selection"`
    - Display three `role="menuitem"` options: System (Monitor icon), Light (Sun icon), Dark (Moon icon)
    - Highlight the active option with accent color and a checkmark indicator
    - On selection: call `setThemePreference(value)`, close the menu, return focus to gear icon
    - Handle Escape key to close and restore focus
    - Handle outside click via `pointerdown` listener to close
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 9.1, 9.2, 9.3, 9.4_

  - [ ]* 5.2 Write property test for toggle active indication (Property 5)
    - **Property 5: Toggle active indication**
    - For any `ThemePreference` as current store state, rendering SettingsMenu with menu open visually distinguishes exactly the matching option with accent color/checkmark
    - **Validates: Requirements 6.4**

  - [ ]* 5.3 Write property test for selection applies and closes (Property 6)
    - **Property 6: Selection applies preference and closes menu**
    - For any theme option, activating it (click/Enter/Space) updates `themePreference` in the store and closes the dropdown
    - **Validates: Requirements 6.5, 9.3**

- [x] 6. Add inline theme-init script to index.html
  - [x] 6.1 Add synchronous `<script>` in `index.html` `<head>` before the Vite entry
    - Read `localStorage["olive:preferences"]` inside try/catch
    - Parse JSON and extract `state.themePreference`
    - If "light" or "dark", use directly; otherwise detect via `matchMedia`
    - Set `document.documentElement.setAttribute("data-theme", resolved)`
    - Set `document.documentElement.style.colorScheme = resolved`
    - Ensure no external module imports (must be self-contained inline JS)
    - _Requirements: 7.1, 7.2, 7.3, 3.2, 3.3_

- [x] 7. Integrate into App.tsx and TitleBar.tsx
  - [x] 7.1 Wire `useThemeEffect` and `SettingsMenu` into App.tsx
    - Import and call `useThemeEffect()` in the `Dashboard` component body
    - Import `SettingsMenu` and add it to the right side of the top navigation bar (web-only header area)
    - _Requirements: 1.1, 1.2, 6.1_

  - [x] 7.2 Add `SettingsMenu` to TitleBar.tsx for Tauri desktop mode
    - Insert `<SettingsMenu />` left of the window control buttons in the drag region exclusion zone
    - Ensure it renders only when Tauri shell is active (follow existing TitleBar conditional patterns)
    - _Requirements: 6.1_

- [x] 8. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript (React + CSS) matching the existing codebase
- The `resolveTheme` function is pure and testable without DOM — prioritize testing it first
- CSS variables cascade to all 26+ feature panels automatically; no per-component changes needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "7.1", "7.2"] }
  ]
}
```
