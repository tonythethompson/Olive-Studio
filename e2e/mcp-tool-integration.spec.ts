import { test, expect } from '@playwright/test';

/**
 * MCP Tool Integration Tests
 *
 * Verifies that the /api/mcp/tool endpoint correctly routes to the Python MCP
 * server and returns structured diagnostics for known Olive error patterns.
 *
 * These tests hit the real server and invoke the Python MCP tool via
 * callOliveMcpTool, so they require:
 *  1. A running dev server (configured in playwright.config.ts)
 *  2. Python venv with olive-mcp-server installed
 */

// ── Shared test data ─────────────────────────────────────────────

const MCP_TOOL_URL = '/api/mcp/tool';

const KNOWN_ERROR_PATTERNS = [
  {
    description: 'ONNX conversion external data format error',
    error_message:
      'InvalidGraph: This model contains a computation cycle of a sub-graph. ' +
      "Node('/model/layers.0/Add') has input size 2 but only 1 input edge.",
  },
  {
    description: 'Quantization calibration data error',
    error_message:
      'onnxruntime.quantization.quantize.QuantError: ' +
      'calibration data reader is required for static quantization',
  },
  {
    description: 'GPU out of memory during AWQ quantization',
    error_message:
      'torch.cuda.OutOfMemoryError: CUDA out of memory. ' +
      'Tried to allocate 2.00 GiB (GPU 0; 15.78 GiB total capacity)',
  },
  {
    description: 'TensorRT engine build failure',
    error_message:
      '[TensorRT] ERROR: 3: Could not find any implementation for node ' +
      '/model/attention/Softmax. [TRT] ERROR: Engine builder failed',
  },
];

const EXPECTED_FIELDS = ['matched_entry', 'root_cause', 'workaround'] as const;

// ── Tests ────────────────────────────────────────────────────────

test.describe('POST /api/mcp/tool — troubleshoot_olive_error', () => {
  for (const { description, error_message } of KNOWN_ERROR_PATTERNS) {
    test(`returns diagnostic for: ${description}`, async ({ request }) => {
      const response = await request.post(MCP_TOOL_URL, {
        data: {
          toolName: 'troubleshoot_olive_error',
          args: { error_message },
        },
      });

      // The endpoint should return 200 even when the Python tool has no match
      expect(response.ok()).toBeTruthy();

      const body = await response.json();

      // Response should not contain a top-level error from the Express layer
      expect(body).not.toHaveProperty('error');

      // Verify required diagnostic fields are present
      for (const field of EXPECTED_FIELDS) {
        expect(body).toHaveProperty(field);
      }

      // matched_entry can be null (no match) or a string (matched)
      if (body.matched_entry !== null) {
        expect(typeof body.matched_entry).toBe('string');
        expect(body.matched_entry.length).toBeGreaterThan(0);
      }

      // root_cause should be a string
      expect(typeof body.root_cause).toBe('string');

      // workaround should be a string
      expect(typeof body.workaround).toBe('string');

      // title should also be present
      expect(body).toHaveProperty('title');
      expect(typeof body.title).toBe('string');
    });
  }

  test('returns structured response with pass_name and config_context args', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'troubleshoot_olive_error',
        args: {
          error_message: 'OnnxQuantization calibration failed',
          pass_name: 'OnnxQuantization',
          config_context: 'CUDAExecutionProvider, int8, static quantization',
        },
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('matched_entry');
    expect(body).toHaveProperty('root_cause');
    expect(body).toHaveProperty('workaround');
    expect(body).toHaveProperty('updated_config');
    expect(body).toHaveProperty('relevant_quirks');

    // relevant_quirks should be an array
    expect(Array.isArray(body.relevant_quirks)).toBeTruthy();
  });

  test('handles unknown error message gracefully (no crash)', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'troubleshoot_olive_error',
        args: { error_message: 'This is a completely unknown random error message XYZ123' },
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();

    // Should still return the diagnostic shape even for unknown errors
    expect(body).toHaveProperty('matched_entry');
    expect(body).toHaveProperty('root_cause');
    expect(body).toHaveProperty('workaround');

    // matched_entry should be null for unknown errors
    expect(body.matched_entry).toBeNull();

    // root_cause and workaround should have fallback values
    expect(typeof body.root_cause).toBe('string');
    expect(typeof body.workaround).toBe('string');
  });

  test('returns 400 when toolName is missing', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: { args: { error_message: 'some error' } },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('toolName');
  });

  test('returns error for non-existent tool name', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'non_existent_tool_xyz',
        args: { error_message: 'some error' },
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('updated_config contains expected structure when a match is found', async ({ request }) => {
    const response = await request.post(MCP_TOOL_URL, {
      data: {
        toolName: 'troubleshoot_olive_error',
        args: {
          error_message:
            'onnxruntime.quantization.quantize.QuantError: calibration data reader is required',
          pass_name: 'OnnxQuantization',
        },
      },
    });

    expect(response.ok()).toBeTruthy();

    const body = await response.json();

    if (body.matched_entry !== null) {
      // When a match is found, updated_config should be an object
      expect(typeof body.updated_config).toBe('object');
      expect(body.updated_config).not.toBeNull();
    }
  });
});
