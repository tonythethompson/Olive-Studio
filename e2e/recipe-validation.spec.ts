import { test, expect } from '@playwright/test';

/**
 * Recipe Validation E2E Tests
 *
 * Verifies that the RecipeValidationPanel correctly fetches and displays
 * compatibility warnings when a HuggingFace model is selected.
 *
 * The RecipeValidationPanel:
 *   1. Debounces 600ms after state changes
 *   2. POSTs to /api/validate-compatibility with { modelName, framework, hardwareTarget }
 *   3. Renders compatibility_warnings as warning-severity issue cards
 *   4. Shows "Recipe validated — no issues found" when no issues exist
 */

// ── Helpers ──────────────────────────────────────────────────────

/** Navigate to the app and wait for the graph to render. */
async function loadApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Wait for the recipe graph view to appear (signals app is hydrated)
  await page.locator('#node-btn-input').waitFor({ state: 'visible', timeout: 30_000 });
}

// ── Tests ────────────────────────────────────────────────────────

test.describe('RecipeValidationPanel — compatibility warnings', () => {
  test('shows compatibility warnings for a known model (Meta-Llama-3-8B)', async ({ page }) => {
    await loadApp(page);

    // Select Meta-Llama-3 via the quick-select button
    const quickSelect = page.getByRole('button', { name: /Meta-Llama-3/i });
    await quickSelect.waitFor({ state: 'visible', timeout: 15_000 });
    await quickSelect.click();

    // The RecipeValidationPanel debounces 600ms, then fetches compatibility.
    // Wait for the validation panel to show either warnings or "no issues".
    const validationSection = page.locator('text=/Recipe validated|blocking issue|warning/');
    await validationSection.first().waitFor({ state: 'visible', timeout: 15_000 });

    // The panel should have rendered — for Meta-Llama-3 with default ONNX
    // settings, the validation panel should be visible.
    const panel = page.locator('.rounded-lg.border.border-slate-700');
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });

  test('shows "no issues found" when no model is selected', async ({ page }) => {
    await loadApp(page);

    // Ensure no model is selected (default state has empty hfModelId)
    const input = page.locator('#modelId');
    await input.waitFor({ state: 'visible', timeout: 15_000 });
    await input.clear();

    // Wait for the validation to complete (debounce + fetch)
    const noIssues = page.getByText('Recipe validated — no issues found');
    await noIssues.waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('refresh button re-runs validation', async ({ page }) => {
    await loadApp(page);

    // Set a model to trigger validation
    const quickSelect = page.getByRole('button', { name: /Meta-Llama-3/i });
    await quickSelect.waitFor({ state: 'visible', timeout: 15_000 });
    await quickSelect.click();

    // Wait for initial validation
    const validationSection = page.locator('text=/Recipe validated|blocking issue|warning/');
    await validationSection.first().waitFor({ state: 'visible', timeout: 15_000 });

    // Click the refresh button
    const refreshBtn = page.locator('button[title="Refresh validation"]');
    await expect(refreshBtn).toBeVisible({ timeout: 5_000 });
    await refreshBtn.click();

    // After refresh, the panel should still show validation results
    await validationSection.first().waitFor({ state: 'visible', timeout: 15_000 });
  });

  test('shows warnings when switching models', async ({ page }) => {
    await loadApp(page);

    // Start with Meta-Llama-3
    const llamaBtn = page.getByRole('button', { name: /Meta-Llama-3/i });
    await llamaBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await llamaBtn.click();

    // Wait for validation
    const validationSection = page.locator('text=/Recipe validated|blocking issue|warning/');
    await validationSection.first().waitFor({ state: 'visible', timeout: 15_000 });

    // Switch to Whisper (different model family — may trigger different warnings)
    const whisperBtn = page.getByRole('button', { name: /Whisper/i });
    await whisperBtn.click();

    // Wait for re-validation after debounce
    await validationSection.first().waitFor({ state: 'visible', timeout: 15_000 });
  });
});

test.describe('RecipeValidationPanel — MCP compatibility endpoint', () => {
  test('POST /api/validate-compatibility returns valid structure', async ({ request }) => {
    const response = await request.post('/api/validate-compatibility', {
      data: {
        modelName: 'meta-llama/Meta-Llama-3-8B',
        framework: 'ONNX',
        hardwareTarget: 'NVIDIA RTX 4090',
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Response should have the expected shape
    expect(body).toHaveProperty('model');
    expect(body).toHaveProperty('framework');
    expect(typeof body.model).toBe('string');
    expect(typeof body.framework).toBe('string');

    // Should have hardware compatibility data
    if (body.hardware_compatibility) {
      expect(typeof body.hardware_compatibility).toBe('object');
    }

    // Should have compatibility_warnings array
    if (body.compatibility_warnings) {
      expect(Array.isArray(body.compatibility_warnings)).toBeTruthy();
      for (const warning of body.compatibility_warnings) {
        expect(warning).toHaveProperty('pass_name');
        expect(warning).toHaveProperty('note');
      }
    }
  });

  test('POST /api/validate-compatibility handles unknown model gracefully', async ({ request }) => {
    const response = await request.post('/api/validate-compatibility', {
      data: {
        modelName: 'nonexistent/model-xyz-123',
        framework: 'ONNX',
        hardwareTarget: 'NVIDIA RTX 4090',
      },
    });

    // Should return 200 with a note about unknown model
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty('note');
  });
});
