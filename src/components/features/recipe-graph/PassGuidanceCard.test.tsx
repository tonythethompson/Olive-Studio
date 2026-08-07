import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import type { PassGuidance } from "@/lib/passGuidance";
import { PassGuidanceCard } from "./PassGuidanceCard";

function makeGuidance(passName = "OnnxConversion"): PassGuidance {
  return {
    title: "ONNX conversion",
    summary: "Convert to ONNX.",
    whatItDoes: "Exports the model graph to ONNX.",
    whenToUse: ["You need ONNX output."],
    whenNotToUse: [],
    passName,
  };
}

function mockFetchJson(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  }));
}

describe("PassGuidanceCard MCP parameter fetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchJson({}));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function expandParams() {
    fireEvent.click(screen.getByRole("button", { name: /Olive Parameters/i }));
  }

  it("stores params on a successful MCP response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchJson({
        parameters: { opset: { type: "int", description: "ONNX opset version" } },
        required_params: ["opset"],
      }),
    );

    render(<PassGuidanceCard guidance={makeGuidance()} />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    await expandParams();

    expect(screen.getByText("opset")).toBeDefined();
    expect(screen.queryByText("Failed to load parameters")).toBeNull();
  });

  it("sets failure state on non-OK HTTP responses", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ error: "ignored" }, false));

    render(<PassGuidanceCard guidance={makeGuidance()} />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    await expandParams();

    expect(screen.getByText("Failed to load parameters")).toBeDefined();
    expect(screen.getByRole("button", { name: /Retry/i })).toBeDefined();
  });

  it("sets failure state when the payload contains error", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ error: "MCP unavailable" }));

    render(<PassGuidanceCard guidance={makeGuidance()} />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    await expandParams();

    expect(screen.getByText("Failed to load parameters")).toBeDefined();
  });

  it("does not apply aborted fetch results to UI state", async () => {
    let resolveFetch: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<PassGuidanceCard guidance={makeGuidance("PassA")} />);
    await expandParams();
    expect(screen.getByText(/loading/i)).toBeDefined();

    unmount();
    await act(async () => {
      resolveFetch!({
        ok: false,
        json: async () => ({ error: "should be ignored" }),
      });
      await Promise.resolve();
    });

    vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(<PassGuidanceCard guidance={makeGuidance("PassB")} />);
    await expandParams();
    expect(screen.getByText(/loading/i)).toBeDefined();
    expect(screen.queryByText("Failed to load parameters")).toBeNull();
  });
});
