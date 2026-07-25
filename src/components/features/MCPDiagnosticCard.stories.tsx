import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { MCPDiagnosticCard } from "./MCPDiagnosticCard";
import type { McpDiagnostic } from "@/types";

const meta: Meta<typeof MCPDiagnosticCard> = {
  title: "Features/MCP Diagnostic Card",
  component: MCPDiagnosticCard,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    backgrounds: { default: "dark" },
  },
  args: {
    onApplyFix: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof MCPDiagnosticCard>;

// ── Mock data ────────────────────────────────────────────────────

const MOCK_DIAGNOSTIC: McpDiagnostic = {
  matched_entry: "onnxruntime-large-model-external-data",
  title: "ONNX Export Fails for Models > 2GB",
  root_cause:
    "ONNX format stores all weights in a single protobuf file. Models exceeding ~2GB hit the protobuf size limit and fail to serialize.",
  workaround:
    "Enable external data format in OnnxConversion to split weights into separate files using the ONNX external data format.",
  updated_config: {
    use_external_data_format: true,
    max_external_data_size: 4294967296,
  },
  relevant_quirks: [
    "PyTorch models with >2B parameters almost always need this flag",
    "The resulting .onnx file will be accompanied by .onnx.data sidecar files",
  ],
};

const MOCK_DIAGNOSTIC_NO_CONFIG: McpDiagnostic = {
  matched_entry: "quantization-precision-mismatch",
  title: "Quantization Precision Not Supported by Provider",
  root_cause:
    "The selected execution provider does not support the requested quantization precision. INT4 quantization requires CUDA or QNN EP with specific driver versions.",
  workaround:
    "Switch to INT8 precision or change the execution provider to one that supports INT4 (CUDA 11.8+, QNN 2.22+).",
};

// ── Stories ──────────────────────────────────────────────────────

/** Card is hidden when executionStatus is not "failed" — this story shows the card directly. */
export const Querying: Story = {
  name: "Querying MCP Knowledge Base",
  args: {
    diagnostic: null,
    isDiagnosing: false,
    fixApplied: "",
  },
  parameters: {
    docs: {
      description: {
        story:
          "The initial state while the component queries the MCP knowledge base. Shows an italic placeholder message.",
      },
    },
  },
};

export const Diagnosing: Story = {
  name: "Diagnosing (Loading)",
  args: {
    diagnostic: null,
    isDiagnosing: true,
    fixApplied: "",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Loading state while a fetch is in flight. The pulsing 'Diagnosing with MCP KB...' indicator appears in the header.",
      },
    },
  },
};

export const WithResult: Story = {
  name: "Diagnostic Result with Config & Quirks",
  args: {
    diagnostic: MOCK_DIAGNOSTIC,
    isDiagnosing: false,
    fixApplied: "",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Full diagnostic result showing issue title, root cause, recommended fix, config changes (blue), and known quirks (amber). The 'Apply Fix' button is enabled.",
      },
    },
  },
};

export const WithoutConfigOrQuirks: Story = {
  name: "Diagnostic Result (Minimal)",
  args: {
    diagnostic: MOCK_DIAGNOSTIC_NO_CONFIG,
    isDiagnosing: false,
    fixApplied: "",
  },
  parameters: {
    docs: {
      description: {
        story:
          "Diagnostic result without updated_config or relevant_quirks — only the three core fields are shown.",
      },
    },
  },
};

export const FixApplied: Story = {
  name: "Fix Applied",
  args: {
    diagnostic: MOCK_DIAGNOSTIC,
    isDiagnosing: false,
    fixApplied: "applied",
  },
  parameters: {
    docs: {
      description: {
        story:
          "After the user clicks 'Apply Fix', the button transforms to a green 'Fix Applied' state with a checkmark. The button is disabled until the auto-clear timer resets.",
      },
    },
  },
};
