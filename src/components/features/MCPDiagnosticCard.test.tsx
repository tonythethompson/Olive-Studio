import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { McpDiagnostic, McpTroubleshootFeedbackResult } from "@/types";

const mockRequestFeedback = vi.fn();

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    requestMcpTroubleshootFeedback: (...args: unknown[]) => mockRequestFeedback(...args),
  };
});

import { MCPDiagnosticCard } from "./MCPDiagnosticCard";

const MATCHED: McpDiagnostic = {
  matched_entry: "onnxruntime-large-model-external-data",
  title: "ONNX Export Fails for Models > 2GB",
  root_cause: "Protobuf size limit for large models.",
  workaround: "Enable external data format in OnnxConversion.",
  updated_config: { use_external_data_format: true },
  domain: "olive",
  applyable: true,
};

const UNMATCHED: McpDiagnostic = {
  matched_entry: null,
  title: "Unrecognized error",
  root_cause: "No KB match for this log pattern.",
  workaround: "Inspect the full Olive log and retry with a simpler pass chain.",
  domain: null,
};

const EMPTY_MATCHED: McpDiagnostic = {
  matched_entry: "",
  title: "Local-only pattern",
  root_cause: "Matched by a local log heuristic without a stable KB id.",
  workaround: "Follow the recommended fix manually.",
};

function okResult(
  rating: "thumbs-up" | "thumbs-down",
  entry = MATCHED.matched_entry!,
): McpTroubleshootFeedbackResult {
  return {
    status: "ok",
    matched_entry: entry,
    rating,
    reason_code: null,
    thumbs_up: rating === "thumbs-up" ? 1 : 0,
    thumbs_down: rating === "thumbs-down" ? 1 : 0,
    total: 1,
    score_delta: rating === "thumbs-up" ? 0.01 : -0.01,
  };
}

describe("MCPDiagnosticCard", () => {
  beforeEach(() => {
    mockRequestFeedback.mockReset();
  });

  it("renders core diagnostic fields and Apply Fix when config is applyable", () => {
    const onApplyFix = vi.fn();
    render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={onApplyFix}
      />,
    );

    expect(screen.getByText(MATCHED.title)).toBeDefined();
    expect(screen.getByText(/Root Cause:/i)).toBeDefined();
    expect(screen.getByText(/Recommended Fix:/i)).toBeDefined();
    expect(screen.getByRole("button", { name: /Apply Fix/i })).toBeDefined();
  });

  it("shows accessible thumbs controls only when matched_entry is a non-empty string", () => {
    const { rerender } = render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Thumbs up/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Thumbs down/i })).toBeDefined();
    expect(screen.getByText("Helpful?")).toBeDefined();

    rerender(
      <MCPDiagnosticCard
        diagnostic={UNMATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Thumbs up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thumbs down/i })).toBeNull();
    expect(screen.queryByText("Helpful?")).toBeNull();

    rerender(
      <MCPDiagnosticCard
        diagnostic={EMPTY_MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Thumbs up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thumbs down/i })).toBeNull();
  });

  it("submits thumbs-up once, disables both controls, and notifies the parent", async () => {
    const user = userEvent.setup();
    const onFeedbackSubmitted = vi.fn();
    mockRequestFeedback.mockResolvedValueOnce(okResult("thumbs-up"));

    render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
        onFeedbackSubmitted={onFeedbackSubmitted}
      />,
    );

    const up = screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i });
    await user.click(up);

    await waitFor(() => {
      expect(mockRequestFeedback).toHaveBeenCalledTimes(1);
    });
    expect(mockRequestFeedback).toHaveBeenCalledWith(
      { matched_entry: MATCHED.matched_entry, rating: "thumbs-up" },
      expect.any(AbortSignal),
    );

    await waitFor(() => {
      expect(onFeedbackSubmitted).toHaveBeenCalledWith({
        matched_entry: MATCHED.matched_entry,
        rating: "thumbs-up",
      });
    });

    expect(screen.getByText(/Thanks for the feedback/i)).toBeDefined();
    expect(
      (screen.getByRole("button", { name: /Thumbs up submitted/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: /Thumbs down/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    // Second click must not re-submit (one submission per result/rating).
    await user.click(screen.getByRole("button", { name: /Thumbs up submitted/i }));
    expect(mockRequestFeedback).toHaveBeenCalledTimes(1);
  });

  it("submits thumbs-down once and does not allow switching rating after success", async () => {
    const user = userEvent.setup();
    mockRequestFeedback.mockResolvedValueOnce(okResult("thumbs-down"));

    render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Thumbs down — this diagnosis was not helpful/i }));

    await waitFor(() => {
      expect(mockRequestFeedback).toHaveBeenCalledTimes(1);
    });
    expect(mockRequestFeedback).toHaveBeenCalledWith(
      { matched_entry: MATCHED.matched_entry, rating: "thumbs-down" },
      expect.any(AbortSignal),
    );

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /Thumbs down submitted/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: /Thumbs up/i }));
    expect(mockRequestFeedback).toHaveBeenCalledTimes(1);
  });

  it("keeps controls enabled and shows retry guidance when the MCP proxy fails", async () => {
    const user = userEvent.setup();
    const onFeedbackSubmitted = vi.fn();
    mockRequestFeedback.mockResolvedValueOnce({
      status: "error",
      error: "http_error",
      message: "Feedback failed (HTTP 502)",
    });

    render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
        onFeedbackSubmitted={onFeedbackSubmitted}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByText(/Feedback failed \(HTTP 502\)/i)).toBeDefined();
    expect(screen.getByText(/You can try again/i)).toBeDefined();
    expect(onFeedbackSubmitted).not.toHaveBeenCalled();

    const up = screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i });
    const down = screen.getByRole("button", { name: /Thumbs down — this diagnosis was not helpful/i });
    expect((up as HTMLButtonElement).disabled).toBe(false);
    expect((down as HTMLButtonElement).disabled).toBe(false);

    mockRequestFeedback.mockResolvedValueOnce(okResult("thumbs-up"));
    await user.click(up);

    await waitFor(() => {
      expect(onFeedbackSubmitted).toHaveBeenCalledTimes(1);
    });
    expect(mockRequestFeedback).toHaveBeenCalledTimes(2);
  });

  it("resets feedback state when matched_entry changes (new diagnosis target)", async () => {
    const user = userEvent.setup();
    mockRequestFeedback.mockResolvedValueOnce(okResult("thumbs-up"));

    const { rerender } = render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i }));
    await waitFor(() => {
      expect(screen.getByText(/Thanks for the feedback/i)).toBeDefined();
    });

    const next: McpDiagnostic = {
      ...MATCHED,
      matched_entry: "quantization-precision-mismatch",
      title: "Quantization Precision Not Supported",
    };
    rerender(
      <MCPDiagnosticCard
        diagnostic={next}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Thanks for the feedback/i)).toBeNull();
    const up = screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i });
    expect((up as HTMLButtonElement).disabled).toBe(false);

    mockRequestFeedback.mockResolvedValueOnce(
      okResult("thumbs-down", "quantization-precision-mismatch"),
    );
    await user.click(screen.getByRole("button", { name: /Thumbs down — this diagnosis was not helpful/i }));
    await waitFor(() => {
      expect(mockRequestFeedback).toHaveBeenLastCalledWith(
        { matched_entry: "quantization-precision-mismatch", rating: "thumbs-down" },
        expect.any(AbortSignal),
      );
    });
  });

  it("does not block Apply Fix while feedback is idle or after feedback success", async () => {
    const user = userEvent.setup();
    const onApplyFix = vi.fn();
    mockRequestFeedback.mockResolvedValueOnce(okResult("thumbs-up"));

    render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={onApplyFix}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Apply Fix/i }));
    expect(onApplyFix).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i }));
    await waitFor(() => {
      expect(screen.getByText(/Thanks for the feedback/i)).toBeDefined();
    });

    // Apply Fix remains independently controlled by fixApplied / canApply.
    await user.click(screen.getByRole("button", { name: /Apply Fix/i }));
    expect(onApplyFix).toHaveBeenCalledTimes(2);
  });

  it("shows diagnosing and error states without feedback controls", () => {
    const { rerender } = render(
      <MCPDiagnosticCard
        diagnostic={null}
        isDiagnosing={true}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );
    expect(screen.getByText(/Diagnosing with MCP KB/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Thumbs up/i })).toBeNull();

    rerender(
      <MCPDiagnosticCard
        diagnostic={null}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
        error="MCP proxy unavailable"
        onRunDiagnosis={vi.fn()}
      />,
    );
    expect(screen.getByText("MCP proxy unavailable")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Thumbs up/i })).toBeNull();
  });

  it("ignores concurrent clicks while a submission is in flight", async () => {
    const user = userEvent.setup();
    let resolveFeedback!: (value: McpTroubleshootFeedbackResult) => void;
    mockRequestFeedback.mockImplementationOnce(
      () =>
        new Promise<McpTroubleshootFeedbackResult>((resolve) => {
          resolveFeedback = resolve;
        }),
    );

    render(
      <MCPDiagnosticCard
        diagnostic={MATCHED}
        isDiagnosing={false}
        fixApplied=""
        onApplyFix={vi.fn()}
      />,
    );

    const up = screen.getByRole("button", { name: /Thumbs up — this diagnosis was helpful/i });
    await user.click(up);
    await waitFor(() => {
      expect(screen.getByText(/Sending/i)).toBeDefined();
    });

    // Both controls disabled while submitting.
    expect((up as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Thumbs down/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => {
      resolveFeedback(okResult("thumbs-up"));
    });

    await waitFor(() => {
      expect(screen.getByText(/Thanks for the feedback/i)).toBeDefined();
    });
    expect(mockRequestFeedback).toHaveBeenCalledTimes(1);
  });
});
