import { test, expect, type Page } from '@playwright/test';

/**
 * Quantization Presets E2E Tests
 *
 * Applies each built-in quantization preset via the Quick Presets dropdown
 * and verifies that the method, precision, and advanced settings all
 * reflect the expected configuration.
 */

// ── Helpers ────────────────────────────────────────────────────────

/** Navigate to the app and open the quantization node in the graph. */
async function openQuantizationInspector(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  // Wait for the graph to render — the quantization node should always exist
  const quantNode = page.locator('#node-btn-quantization');
  await quantNode.waitFor({ state: 'visible', timeout: 30000 });
  await quantNode.click();

  // Quantization is disabled by default — check if the Activate Pass button appears.
  // Use waitFor with a short timeout instead of isVisible() to avoid race conditions.
  const activateBtn = page.getByRole('button', { name: /activate pass/i });
  const activateVisible = await activateBtn
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (activateVisible) {
    await activateBtn.click();
  }

  // Wait for the quantization method dropdown to appear
  await page.locator('#quant-method').waitFor({ state: 'visible', timeout: 15000 });
}

/** Select a preset by its full option label from the Quick Presets dropdown. */
async function applyPreset(page: Page, presetLabel: string) {
  const select = page.locator('#quant-presets');
  await select.selectOption({ label: presetLabel });
}

/** Assert that a select has the expected value. */
async function expectSelectValue(page: Page, id: string, expected: string) {
  await expect(page.locator(`#${id}`)).toHaveValue(expected);
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
  labelPrefix: string;
  /** Full option label for selectOption — must match `{preset.label} — {preset.description}`. */
  fullLabel: string;
  method: string;
  precision: string;
  /** IDs of advanced settings sections that should be visible. */
  advancedSections: string[];
  /** Optional advanced field assertions: [selectId, expectedValue] */
  advancedFields?: [string, string][];
}

const PRESETS: PresetTest[] = [
  {
    labelPrefix: 'Default INT4',
    fullLabel: 'Default INT4 — Post-training INT4 quantization — broadest compatibility',
    method: 'ptq',
    precision: 'int4',
    advancedSections: [],
  },
  {
    labelPrefix: 'Default INT8',
    fullLabel: 'Default INT8 — Post-training INT8 — balanced size and accuracy',
    method: 'ptq',
    precision: 'int8',
    advancedSections: [],
  },
  {
    labelPrefix: 'AWQ Balanced',
    fullLabel: 'AWQ Balanced — AWQ INT4 with symmetric 128-group activation-aware quantization',
    method: 'awq',
    precision: 'int4',
    advancedSections: ['AWQ advanced settings'],
    advancedFields: [
      ['awq-group-size', '128'],
      ['awq-damp-percent', '0.01'],
      ['awq-sym', 'checked'],
    ],
  },
  {
    labelPrefix: 'AWQ High Quality',
    fullLabel: 'AWQ High Quality — AWQ INT4 with finer 64-group, lower dampening, asymmetric',
    method: 'awq',
    precision: 'int4',
    advancedSections: ['AWQ advanced settings'],
    advancedFields: [
      ['awq-group-size', '64'],
      ['awq-damp-percent', '0.005'],
      ['awq-sym', 'unchecked'],
    ],
  },
  {
    labelPrefix: 'GPTQ High Quality',
    fullLabel: 'GPTQ High Quality — GPTQ INT4 with desc_act on, block 128, group 128 — best accuracy',
    method: 'gptq',
    precision: 'int4',
    advancedSections: ['GPTQ advanced settings'],
    advancedFields: [
      ['gptq-block-size', '128'],
      ['gptq-group-size', '128'],
      ['gptq-desc-act', 'checked'],
    ],
  },
  {
    labelPrefix: 'GPTQ Fast',
    fullLabel: 'GPTQ Fast — GPTQ INT4 with desc_act off, block 256, group 128 — fastest',
    method: 'gptq',
    precision: 'int4',
    advancedSections: ['GPTQ advanced settings'],
    advancedFields: [
      ['gptq-block-size', '256'],
      ['gptq-group-size', '128'],
      ['gptq-desc-act', 'unchecked'],
    ],
  },
  {
    labelPrefix: 'QAT INT4',
    fullLabel: 'QAT INT4 — Best Accuracy — QAT INT4 with entropy calibration, 20 steps — highest quality',
    method: 'qat',
    precision: 'int4',
    advancedSections: ['QAT advanced settings'],
    advancedFields: [
      ['qat-target-precision', 'int4'],
      ['qat-calibrate-method', 'entropy'],
      ['qat-calibrate-steps', '20'],
    ],
  },
  {
    labelPrefix: 'QAT INT8',
    fullLabel: 'QAT INT8 — Balanced — QAT INT8 with percentile calibration, 10 steps — good accuracy/speed',
    method: 'qat',
    precision: 'int8',
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
  // Increase timeout for complex async setup (goto → click → activate → wait)
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await openQuantizationInspector(page);
  });

  for (const preset of PRESETS) {
    test(`applies preset: ${preset.labelPrefix}`, async ({ page }) => {
      // Apply the preset
      await applyPreset(page, preset.fullLabel);

      // Verify method dropdown
      await expectSelectValue(page, 'quant-method', preset.method);

      // Verify precision dropdown
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

      // Verify advanced field values
      if (preset.advancedFields) {
        for (const [fieldId, expectedValue] of preset.advancedFields) {
          if (expectedValue === 'checked') {
            await expect(page.locator(`#${fieldId}`)).toHaveAttribute('aria-checked', 'true');
          } else if (expectedValue === 'unchecked') {
            await expect(page.locator(`#${fieldId}`)).toHaveAttribute('aria-checked', 'false');
          } else {
            await expectSelectValue(page, fieldId, expectedValue);
          }
        }
      }
    });
  }

  test('PTQ presets do not show any advanced settings', async ({ page }) => {
    await applyPreset(page, PRESETS[0].fullLabel); // Default INT4

    await expectAdvancedHidden(page, 'GPTQ advanced settings');
    await expectAdvancedHidden(page, 'AWQ advanced settings');
    await expectAdvancedHidden(page, 'QAT advanced settings');
    await expectAdvancedHidden(page, 'HQQ advanced settings');
    await expectAdvancedHidden(page, 'RTN settings');
    await expectAdvancedHidden(page, 'SpinQuant info');
    await expectAdvancedHidden(page, 'QuaRot info');
  });

  test('switching between presets updates all fields correctly', async ({ page }) => {
    // Start with AWQ Balanced
    await applyPreset(page, PRESETS[2].fullLabel);
    await expectSelectValue(page, 'quant-method', 'awq');
    await expectAdvancedVisible(page, 'AWQ advanced settings');
    await expectAdvancedHidden(page, 'GPTQ advanced settings');

    // Switch to GPTQ Fast
    await applyPreset(page, PRESETS[5].fullLabel);
    await expectSelectValue(page, 'quant-method', 'gptq');
    await expectSelectValue(page, 'quant-target-precision', 'int4');
    await expectAdvancedVisible(page, 'GPTQ advanced settings');
    await expectAdvancedHidden(page, 'AWQ advanced settings');

    // Verify GPTQ advanced fields updated
    await expectSelectValue(page, 'gptq-block-size', '256');
    await expectSelectValue(page, 'gptq-group-size', '128');

    // Switch to QAT INT8
    await applyPreset(page, PRESETS[7].fullLabel);
    await expectSelectValue(page, 'quant-method', 'qat');
    await expectSelectValue(page, 'quant-target-precision', 'int8');
    await expectAdvancedVisible(page, 'QAT advanced settings');
    await expectAdvancedHidden(page, 'GPTQ advanced settings');

    // Verify QAT advanced fields
    await expectSelectValue(page, 'qat-calibrate-method', 'percentile');
    await expectSelectValue(page, 'qat-calibrate-steps', '10');
  });

  test('export button is disabled when no custom presets exist', async ({ page }) => {
    const exportBtn = page.locator('button[aria-label="Export presets"]');
    await expect(exportBtn).toBeDisabled();
  });
});
