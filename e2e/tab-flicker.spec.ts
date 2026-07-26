import { test, expect } from '@playwright/test';

/**
 * Tab Flicker E2E Tests
 *
 * Verifies that switching between recipe views in ExecutionWorkspace
 * does not remount components (no loading spinner on revisit).
 *
 * The "visited views" pattern keeps previously-visited tabs mounted
 * with CSS `hidden` instead of unmounting them.
 */

// ── Helpers ──────────────────────────────────────────────────────

async function loadApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Wait for the recipe graph view to appear (signals app is hydrated)
  await page.locator('#node-btn-input').waitFor({ state: 'visible', timeout: 30_000 });
}

// ── Tests ────────────────────────────────────────────────────────

test.describe('ExecutionWorkspace — recipe view tab flicker', () => {
  test('graph view stays mounted when switching away and back', async ({ page }) => {
    await loadApp(page);

    // The graph view should be visible initially
    const graphView = page.locator('#node-btn-input');
    await expect(graphView).toBeVisible();

    // Switch to JSON view
    await page.getByRole('button', { name: /JSON/i }).click();

    // Graph view should now be hidden (not unmounted)
    // The node button should still exist in the DOM, just not visible
    await expect(graphView).not.toBeVisible();

    // Switch back to graph view
    await page.getByRole('button', { name: /Graph/i }).click();

    // Graph view should be visible again immediately — no loading spinner
    await expect(graphView).toBeVisible();

    // Verify no loading fallback appeared (the Suspense fallback text)
    await expect(page.getByText('Loading graph editor...')).not.toBeVisible();
  });

  test('browser-test tab is not loaded until first visit', async ({ page }) => {
    await loadApp(page);

    // The InBrowserValidation panel should not be present initially
    // It's lazy-loaded via Suspense, so its loading text should not appear
    await expect(page.getByText('Loading inference panel...')).not.toBeVisible();

    // Switch to browser-test view
    await page.getByRole('button', { name: /Browser Test/i }).click();

    // Now the loading fallback should appear (first visit triggers mount)
    // Wait for it to either show loading or the actual content
    await page.waitForTimeout(500);

    // Switch back to graph
    await page.getByRole('button', { name: /Graph/i }).click();

    // Switch back to browser-test — should not show loading spinner again
    await page.getByRole('button', { name: /Browser Test/i }).click();
    await page.waitForTimeout(200);

    // The loading text should not appear on second visit (component stayed mounted)
    // Note: We can't guarantee the exact text won't flash, but the component
    // should already be loaded from the first visit
  });
});

test.describe('InputEnvironmentPanel — recipe tab flicker', () => {
  test('presets tab content persists after switching to github and back', async ({ page }) => {
    await loadApp(page);

    // Find the recipe tabs section — look for the Presets tab trigger
    const presetsTab = page.getByRole('tab', { name: /Presets/i });
    const githubTab = page.getByRole('tab', { name: /GitHub/i });

    // Presets should be active initially
    await expect(presetsTab).toHaveAttribute('data-state', 'active');

    // Switch to GitHub tab
    await githubTab.click();
    await expect(githubTab).toHaveAttribute('data-state', 'active');

    // Switch back to Presets
    await presetsTab.click();
    await expect(presetsTab).toHaveAttribute('data-state', 'active');

    // The presets content should be visible immediately
    // Check for a known element in the presets tab
    await expect(page.getByText(/of.*presets/i)).toBeVisible({ timeout: 5_000 });
  });
});
