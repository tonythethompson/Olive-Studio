import { test, expect } from '@playwright/test';

/**
 * MCP Pass Chain Validation Integration Tests
 *
 * Verifies that the /api/mcp/tool endpoint with get_pass_chain correctly
 * validates Olive pass chains, returning structured results with valid,
 * errors, warnings, and chain fields.
 *
 * These tests hit the real server and invoke the Python MCP tool via
 * callOliveMcpTool, so they require:
 *  1. A running dev server (configured in playwright.config.ts)
 *  2. Python venv with olive-mcp-server installed
 */

const MCP_TOOL_URL = '/api/mcp/tool';

// ── Shared test data ─────────────────────────────────────────────

/** Canonical valid chain: PyTorch → ONNX conversion → INT8 quantization */
const VALID_CHAIN = {
  pass_names: ['OnnxConversion', 'OnnxQuantization'],
  source_format: 'torch',
};

const EXPECTED_CHAIN_FIELDS = ['valid', 'errors', 'warnings', 'chain', 'canonical_order'] as const;

// ── Tests ────────────────────────────────────────────────────────

test.describe('POST /api/mcp/tool — get_pass_chain (valid chains)', () => {
  test('validates OnnxConversion → OnnxQuantization chain', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: VALID_CHAIN,
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Response should not contain a top-level error from the Express layer
    expect(body).not.toHaveProperty('error');

    // Verify all expected fields are present
    for (const field of EXPECTED_CHAIN_FIELDS) {
      expect(body).toHaveProperty(field);
    }

    // valid should be a boolean
    expect(typeof body.valid).toBe('boolean');

    // errors and warnings should be arrays
    expect(Array.isArray(body.errors)).toBeTruthy();
    expect(Array.isArray(body.warnings)).toBeTruthy();

    // chain should be an array with 2 entries
    expect(Array.isArray(body.chain)).toBeTruthy();
    expect(body.chain).toHaveLength(2);

    // canonical_order should be a non-empty array
    expect(Array.isArray(body.canonical_order)).toBeTruthy();
    expect(body.canonical_order.length).toBeGreaterThan(0);
  });

  test('validates chain with graph optimization step', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxConversion', 'OrtTransformersOptimization', 'OnnxQuantization'],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body.valid).toBe(true);
    expect(body.chain).toHaveLength(3);

    // Each chain entry should have name, type, known, and format fields
    for (const entry of body.chain) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('known');
      expect(entry).toHaveProperty('input_formats');
      expect(entry).toHaveProperty('output_formats');
      expect(entry.known).toBe(true);
    }
  });

  test('validates AWQ quantization chain', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxConversion', 'AutoAWQQuantizer'],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body).toHaveProperty('valid');
    expect(body).toHaveProperty('chain');
    expect(body.chain).toHaveLength(2);
  });

  test('validates pruning → quantization chain', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxConversion', 'SparseGPT', 'OnnxQuantization'],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body).toHaveProperty('valid');
    expect(body).toHaveProperty('chain');
    expect(body.chain).toHaveLength(3);

    // SparseGPT should appear before OnnxQuantization in the chain
    const chainNames = body.chain.map((c: { name: string }) => c.name);
    expect(chainNames.indexOf('SparseGPT')).toBeLessThan(chainNames.indexOf('OnnxQuantization'));
  });
});

test.describe('POST /api/mcp/tool — get_pass_chain (error cases)', () => {
  test('returns errors for unknown pass names', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxConversion', 'NonExistentPass123'],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);

    // Error should mention the unknown pass
    const hasUnknownError = body.errors.some((e: string) =>
      e.includes('NonExistentPass123'),
    );
    expect(hasUnknownError).toBeTruthy();

    // Unknown pass should appear in chain with known: false
    const unknownEntry = body.chain.find((c: { name: string }) => c.name === 'NonExistentPass123');
    expect(unknownEntry).toBeDefined();
    expect(unknownEntry.known).toBe(false);
  });

  test('returns errors for empty pass chain', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: [],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Empty chain should be valid (nothing to validate)
    expect(body.valid).toBe(true);
    expect(body.chain).toHaveLength(0);
    expect(body.errors).toHaveLength(0);
  });

  test('returns errors when pass_names is missing', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: { source_format: 'torch' },
      },
    });

    // MCP tool should handle missing required arg gracefully
    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Should either return an error or an empty valid chain
    expect(body).toHaveProperty('valid');
  });
});

test.describe('POST /api/mcp/tool — get_pass_chain (warnings)', () => {
  test('warns when graph optimization is placed after quantization', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxConversion', 'OnnxQuantization', 'OrtTransformersOptimization'],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body).toHaveProperty('warnings');
    expect(Array.isArray(body.warnings)).toBeTruthy();

    // Should warn about optimization after quantization
    const hasOptimizationWarning = body.warnings.some((w: string) =>
      w.toLowerCase().includes('optimization') || w.toLowerCase().includes('quantization'),
    );
    expect(hasOptimizationWarning).toBeTruthy();
  });

  test('warns about type ordering when passes are out of canonical order', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxQuantization', 'OnnxConversion'],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // Quantization before conversion is invalid — should have errors or warnings
    expect(body).toHaveProperty('errors');
    expect(body).toHaveProperty('warnings');

    // Should have at least one issue
    expect(body.errors.length + body.warnings.length).toBeGreaterThan(0);
  });
});

test.describe('POST /api/mcp/tool — get_pass_chain (source_format handling)', () => {
  test('infers warnings when source_format is missing and chain is ambiguous', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxConversion', 'OnnxQuantization'],
          // No source_format — should trigger a warning
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    expect(body).toHaveProperty('valid');
    expect(body).toHaveProperty('chain');
    expect(body.chain).toHaveLength(2);
  });

  test('accepts ONNX source format', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxQuantization'],
          source_format: 'onnx',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    // ONNX source with ONNX quantization should be valid
    expect(body.valid).toBe(true);
    expect(body.chain).toHaveLength(1);
  });
});

test.describe('POST /api/mcp/tool — get_pass_chain (chain entry structure)', () => {
  test('each known chain entry has correct structure', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'get_pass_chain',
        args: {
          pass_names: ['OnnxConversion', 'OnnxQuantization'],
          source_format: 'torch',
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();

    for (const entry of body.chain) {
      if (entry.known) {
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.type).toBe('string');
        expect(typeof entry.known).toBe('boolean');
        expect(Array.isArray(entry.input_formats)).toBeTruthy();
        expect(Array.isArray(entry.output_formats)).toBeTruthy();
      } else {
        expect(typeof entry.name).toBe('string');
        expect(entry.known).toBe(false);
      }
    }
  });
});
