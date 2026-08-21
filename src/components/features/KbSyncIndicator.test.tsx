import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KbSyncIndicator } from "./KbSyncIndicator";

const freshKb = {
  available: true,
  version: "1.0.0",
  lastUpdated: new Date().toISOString(),
  lastSync: new Date().toISOString(),
  passCount: 42,
};

function stubKbStatus(body: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
    const urlStr = String(url);
    if (urlStr.includes("/api/mcp/kb-status")) {
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
}

function renderWithProvider(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KbSyncIndicator compact mode", () => {
  it("shows full labels when compact is false", async () => {
    stubKbStatus(freshKb);
    renderWithProvider(<KbSyncIndicator compact={false} />);
    // The KB version text should be visible (not hidden)
    const kbVersion = await screen.findByText(/KB v1\.0\.0/i);
    expect(kbVersion).toBeTruthy();
    expect(kbVersion.className).not.toContain("hidden");

    // "sync" button text should be visible
    const syncText = screen.getByText("sync");
    expect(syncText).toBeTruthy();
    expect(syncText.className).not.toContain("hidden");
  });

  it("hides text labels when compact is true (icon-only)", async () => {
    stubKbStatus(freshKb);
    renderWithProvider(<KbSyncIndicator compact={true} />);
    // Wait for the KB version to appear (even if hidden)
    await waitFor(() => {
      const el = screen.queryByText(/KB v1\.0\.0/);
      expect(el).not.toBeNull();
    });

    // The KB version text should be hidden
    const kbVersion = screen.getByText(/KB v1\.0\.0/);
    expect(kbVersion.className).toContain("hidden");

    // "sync" button text should be hidden
    const syncSpans = screen.getAllByText("sync");
    for (const el of syncSpans) {
      expect(el.className).toContain("hidden");
    }
  });
});
