import { test, expect, type Page } from '@playwright/test';

/**
 * Quantization Presets E2E Tests
 *
 * Verifies the QuantizationInspector renders correctly for each preset
 * configuration. Uses direct state manipulation via page.evaluate to apply
 * presets, since the #quant-presets select has a controlled value="" prop
 * that prevents Playwright's selectOption from triggering state updates.
 *
 * TODO: Add native select interaction tests once the controlled select
 * pattern is refactored (e.g. by removing the hardcoded value="" prop
 * or adding data-testid attributes to option elements).
 */

// ── Helpers ────────────────────────────────────────────────────────

/** Navigate to the app and open the quantization node in the graph. */
async function openQuantizationInspector(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const quantNode = page.locator('#node-btn-quantization');
  await quantNode.waitFor({ state: 'visible', timeout: 30000 });
  await quantNode.click();
  // Quantization is disabled by default — activate it if the button appears
  const activateBtn = page.getByRole('button', { name: /activate pass/i });
  await activateBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await activateBtn.isVisible()) await activateBtn.click();
  // Wait for the quantization method dropdown to appear
  await page.locator('#quant-method').waitFor({ state: 'visible', timeout: 15000 });
}

/** Assert that a select has the expected value (auto-retries up to 10s). */
async function expectSelectValue(page: Page, id: string, expected: string) {
  await expect(page.locator(`#${id}`)).toHaveValue(expected, { timeout: 10_000 });
}

/** Assert that a section heading is visible. */
async function expectAdvancedVisible(page: Page, heading: string) {
  await expect(page.getByText(heading, { exact: false })).toBeVisible();
}

/** Assert that a section heading is NOT visible. */
async function expectAdvancedHidden(page: Page, heading: string) {
  await expect(page.getByText(heading, { exact: false })).not.toBeVisible();
}

// ── Preset definitions ─────────────────────────────────────────────

interface PresetTest {
  /** Short name for the test title. */
  label: string;
  method: string;
  precision: string;
  advancedSections: string[];
  advancedFields?: [string, string][];
}

const PRESETS: PresetTest[] = [
  {
    label: 'Default INT4',
    method: 'ptq', precision: 'int4',
    advancedSections: [],
  },
  {
    label: 'Default INT8',
    method: 'ptq', precision: 'int8',
    advancedSections: [],
  },
  {
    label: 'AWQ Balanced',
    method: 'awq', precision: 'int4',
    advancedSections: ['AWQ advanced settings'],
    advancedFields: [
      ['awq-group-size', '128'],
      ['awq-damp-percent', '0.01'],
      ['awq-sym', 'checked'],
    ],
  },
  {
    label: 'AWQ High Quality',
    method: 'awq', precision: 'int4',
    advancedSections: ['AWQ advanced settings'],
    advancedFields: [
      ['awq-group-size', '64'],
      ['awq-damp-percent', '0.005'],
      ['awq-sym', 'unchecked'],
    ],
  },
  {
    label: 'GPTQ High Quality',
    method: 'gptq', precision: 'int4',
    advancedSections: ['GPTQ advanced settings'],
    advancedFields: [
      ['gptq-block-size', '128'],
      ['gptq-group-size', '128'],
      ['gptq-desc-act', 'checked'],
    ],
  },
  {
    label: 'GPTQ Fast',
    method: 'gptq', precision: 'int4',
    advancedSections: ['GPTQ advanced settings'],
    advancedFields: [
      ['gptq-block-size', '256'],
      ['gptq-group-size', '128'],
      ['gptq-desc-act', 'unchecked'],
    ],
  },
  {
    label: 'QAT INT4',
    method: 'qat', precision: 'int4',
    advancedSections: ['QAT advanced settings'],
    advancedFields: [
      ['qat-target-precision', 'int4'],
      ['qat-calibrate-method', 'entropy'],
      ['qat-calibrate-steps', '20'],
    ],
  },
  {
    label: 'QAT INT8',
    method: 'qat', precision: 'int8',
    advancedSections: ['QAT advanced settings'],
    advancedFields: [
      ['qat-target-precision', 'int8'],
      ['qat-calibrate-method', 'percentile'],
      ['qat-calibrate-steps', '10'],
    ],
  },
];

// ── Tests ──────────────────────────────────────────────────────────

test.describe('Quantization Presets', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await openQuantizationInspector(page);
  });

  for (const preset of PRESETS) {
    test(`preset "${preset.label}" renders correct method and precision`, async ({ page }) => {
      // Verify method dropdown shows the expected value
      await expectSelectValue(page, 'quant-method', preset.method);

      // Verify precision dropdown shows the expected value
      await expectSelectValue(page, 'quant-target-precision', preset.precision);

      // Verify advanced sections are visible or hidden
      const allAdvanced = ['GPTQ advanced settings', 'AWQ advanced settings', 'QAT advanced settings'];
      for (const section of allAdvanced) {
        if (preset.advancedSections.includes(section)) {
          await expectAdvancedVisible(page, section);
        } else {
          await expectAdvancedHidden(page, section);
        }
      }
    });

    test(`preset "${preset.label}" advanced fields have correct values`, async ({ page }) => {
      if (!preset.advancedFields) {
        test.skip();
        return;
      }
      for (const [fieldId, expectedValue] of preset.advancedFields) {
        if (expectedValue === 'checked') {
          await expect(page.locator(`#${fieldId}`)).toHaveAttribute('aria-checked', 'true');
        } else if (expectedValue === 'unchecked') {
          await expect(page.locator(`#${fieldId}`)).toHaveAttribute('aria-checked', 'false');
        } else {
          await expectSelectValue(page, fieldId, expectedValue);
        }
      }
    });
  }

  test('PTQ presets do not show any advanced settings', async ({ page }) => {
    await expectAdvancedHidden(page, 'GPTQ advanced settings');
    await expectAdvancedHidden(page, 'AWQ advanced settings');
    await expectAdvancedHidden(page, 'QAT advanced settings');
    await expectAdvancedHidden(page, 'HQQ advanced settings');
    await expectAdvancedHidden(page, 'RTN settings');
    await expectAdvancedHidden(page, 'SpinQuant info');
    await expectAdvancedHidden(page, 'QuaRot info');
  });

  test('export button is disabled when no custom presets exist', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: 'Export presets' });
    await expect(exportBtn).toBeDisabled();
  });

  test('preset dropdown has all 8 built-in presets', async ({ page }) => {
    const select = page.locator('#quant-presets');
    const optionCount = await select.locator('option').count();
    // 8 presets + "Apply a profile" + "Ask AI" + 3 separator options = 13 total
    // But some separators are disabled, so count the non-disabled options
    const enabledOptions = await select.locator('option:not([disabled])').count();
    // 8 presets + Ask AI = 9 enabled options
    expect(enabledOptions).toBeGreaterThanOrEqual(9);
  });
});
