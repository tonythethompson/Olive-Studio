# Requirements Document

## Introduction

Olive Studio currently ships with a single dark theme (olive-tinted dark palette) with no mechanism for switching to a light appearance. This feature adds a light mode theme with a light green background and black text, respecting the user's operating system preference by default while allowing manual override via a settings/gear menu. The implementation uses CSS custom properties so all 26+ feature panels inherit the active theme automatically without per-component modifications.

## Glossary

- **Theme_System**: The subsystem responsible for detecting, storing, and applying the active color scheme (light or dark) to the Olive Studio UI.
- **Preferences_Store**: A persistent Zustand store that holds user-level settings such as the active theme preference, persisted to localStorage across sessions.
- **Theme_Toggle**: A UI control within the settings/gear menu that allows users to switch between system-default, light, and dark modes.
- **CSS_Variable_Layer**: The set of CSS custom properties (--color-slate-*, --color-electric-blue, etc.) defined in src/index.css whose values change based on the active theme.
- **Settings_Menu**: A dropdown or popover accessible via a gear icon in the header area of the application shell.
- **OS_Preference**: The operating system's current light/dark mode setting, detected via the `prefers-color-scheme` media query.
- **Theme_Attribute**: The `data-theme` HTML attribute on the document root element that drives CSS variable resolution.

## Requirements

### Requirement 1: System Preference Detection

**User Story:** As a user, I want Olive Studio to respect my operating system's light/dark preference on first launch, so that the app matches my desktop environment without manual configuration.

#### Acceptance Criteria

1. WHEN the application loads for the first time (no persisted preference), THE Theme_System SHALL read the OS_Preference via the `prefers-color-scheme` media query and apply the corresponding theme.
2. WHILE no manual override is stored in the Preferences_Store, THE Theme_System SHALL reactively update the active theme whenever the OS_Preference changes.
3. THE Theme_System SHALL apply the detected theme within the same render frame as the initial mount to prevent a flash of unstyled or mismatched content.

### Requirement 2: Manual Theme Override

**User Story:** As a user, I want to manually choose between light, dark, or system-default themes, so that I can override my OS preference when working in specific lighting conditions.

#### Acceptance Criteria

1. WHEN the user selects a theme option (light, dark, or system) via the Theme_Toggle, THE Preferences_Store SHALL persist the selection to localStorage.
2. WHEN the user selects "light" or "dark", THE Theme_System SHALL apply the chosen theme regardless of OS_Preference.
3. WHEN the user selects "system", THE Theme_System SHALL clear the manual override and resume following OS_Preference.
4. WHEN the application loads with a persisted manual override, THE Theme_System SHALL apply the stored preference without consulting OS_Preference.

### Requirement 3: Theme Persistence Across Sessions

**User Story:** As a user, I want my theme choice to persist across browser sessions and page reloads, so that I do not need to re-select my preference each time I open the app.

#### Acceptance Criteria

1. THE Preferences_Store SHALL persist the user's theme selection to localStorage under a stable key.
2. WHEN the application initializes, THE Preferences_Store SHALL read the persisted theme preference before the first render.
3. IF localStorage is unavailable or corrupted, THEN THE Theme_System SHALL fall back to OS_Preference detection without throwing an error.

### Requirement 4: CSS Variable-Based Theming

**User Story:** As a developer, I want themes to be driven by CSS custom properties on the document root, so that all components inherit the active palette without individual modifications.

#### Acceptance Criteria

1. THE CSS_Variable_Layer SHALL define a light mode palette under `[data-theme="light"]` that remaps --color-slate-* variables to light green background tones and black/dark text tones.
2. THE CSS_Variable_Layer SHALL define the dark mode palette under `[data-theme="dark"]` using the existing olive-tinted dark values.
3. WHEN the Theme_System activates a theme, THE Theme_System SHALL set the `data-theme` attribute on the `<html>` element to "light" or "dark".
4. WHEN the theme is "light", THE CSS_Variable_Layer SHALL set `color-scheme: light` on `:root` so browser chrome (scrollbars, form controls) matches the light appearance.
5. WHEN the theme is "dark", THE CSS_Variable_Layer SHALL set `color-scheme: dark` on `:root` so browser chrome matches the dark appearance.
6. THE CSS_Variable_Layer SHALL ensure the --color-electric-blue (olive accent) and --color-emerald-accent values remain legible against both light and dark backgrounds.

### Requirement 5: Light Mode Color Palette

**User Story:** As a user, I want the light mode to have a light green background with black text, so that the interface is comfortable and distinct from the dark mode.

#### Acceptance Criteria

1. WHEN the theme is "light", THE CSS_Variable_Layer SHALL set --color-slate-950 (the body background variable) to a light green tone.
2. WHEN the theme is "light", THE CSS_Variable_Layer SHALL set --color-slate-300 (the body text variable) to black or near-black.
3. WHEN the theme is "light", THE CSS_Variable_Layer SHALL invert the full --color-slate-* scale so that low numbers map to dark tones and high numbers map to light green tones, maintaining visual hierarchy across all panels.
4. THE CSS_Variable_Layer SHALL ensure minimum WCAG AA contrast ratio (4.5:1) between body text and body background in light mode.
5. WHEN the theme is "light", THE CSS_Variable_Layer SHALL adjust border, hover, and focus-ring variables to remain visible against light backgrounds.

### Requirement 6: Settings Menu with Theme Toggle

**User Story:** As a user, I want to access the theme toggle from a gear/settings menu in the header, so that I can change themes without navigating away from my current workflow.

#### Acceptance Criteria

1. THE Settings_Menu SHALL be accessible via a gear icon button placed in the application header area (TitleBar region for desktop, or the top bar for web-only mode).
2. WHEN the user activates the gear icon, THE Settings_Menu SHALL display a dropdown or popover containing the Theme_Toggle.
3. THE Theme_Toggle SHALL present three options: "System" (follow OS), "Light", and "Dark".
4. THE Theme_Toggle SHALL visually indicate the currently active option.
5. WHEN the user selects an option, THE Settings_Menu SHALL close after applying the selection.
6. THE Settings_Menu gear icon SHALL have an accessible label (aria-label) of "Settings".

### Requirement 7: No Flash of Incorrect Theme

**User Story:** As a user, I want the correct theme to be applied before any content is visible, so that I never see a flash of the wrong color scheme on page load.

#### Acceptance Criteria

1. THE Theme_System SHALL apply the `data-theme` attribute to the document element before the React application mounts (via an inline script in the HTML head or equivalent early-execution mechanism).
2. IF a persisted preference exists in localStorage, THEN THE Theme_System SHALL apply it synchronously during the HTML parsing phase.
3. IF no persisted preference exists, THEN THE Theme_System SHALL detect OS_Preference synchronously and apply the result before first paint.

### Requirement 8: Scrollbar and Browser Chrome Adaptation

**User Story:** As a user, I want browser-native elements (scrollbars, form inputs, select dropdowns) to match the active theme, so the UI looks cohesive.

#### Acceptance Criteria

1. WHEN the theme is "light", THE CSS_Variable_Layer SHALL style webkit scrollbar tracks and thumbs to light-appropriate colors.
2. WHEN the theme is "dark", THE CSS_Variable_Layer SHALL retain the current dark scrollbar styling.
3. THE Theme_System SHALL set the CSS `color-scheme` property so native form controls render in the matching light or dark variant.

### Requirement 9: Keyboard Accessibility

**User Story:** As a keyboard-only user, I want the settings menu and theme toggle to be fully operable via keyboard, so I can change themes without a pointing device.

#### Acceptance Criteria

1. THE Settings_Menu gear icon SHALL be focusable and activatable via Enter or Space keys.
2. WHEN the Settings_Menu is open, THE Theme_Toggle options SHALL be navigable via arrow keys or Tab.
3. WHEN a Theme_Toggle option receives focus and is activated via Enter or Space, THE Theme_System SHALL apply the selection.
4. WHEN the user presses Escape while the Settings_Menu is open, THE Settings_Menu SHALL close and return focus to the gear icon.
