import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RuntimeEnvControls } from "./RuntimeEnvControls";

const installedStatus = {
  venvExists: true,
  venvPython: "/tmp/.venv/bin/python",
  venvScripts: "/tmp/.venv/bin",
  oliveInstalled: true,
  oliveVersion: "0.7.0",
  systemPython: "/usr/bin/python3",
  configuredPython: "/tmp/.venv/bin/python",
  venvOnUserPath: true,
  platform: "linux",
  hint: null,
  pythonPrerequisite: null,
};

function stubRuntime(body: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
    const urlStr = String(url);
    if (urlStr.includes("/api/env/runtime")) {
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RuntimeEnvControls compact mode", () => {
  it("shows full labels when compact is false", async () => {
    stubRuntime(installedStatus);
    render(<RuntimeEnvControls compact={false} />);

    // Wait for the runtime label to appear (e.g. "Olive 0.7.0")
    const label = await screen.findByText(/Olive 0\.7\.0/i);
    expect(label).toBeTruthy();
    expect(label.className).not.toContain("hidden");
  });

  it("hides text labels when compact is true (icon-only)", async () => {
    stubRuntime(installedStatus);
    render(<RuntimeEnvControls compact={true} />);

    // Wait for status to load — the button should exist with an aria-label
    await waitFor(() => {
      const btn = screen.queryByRole("button", { expanded: false });
      expect(btn).not.toBeNull();
    });

    // The runtime label text should be hidden when compact
    const label = screen.queryByText(/Olive 0\.7\.0/i);
    // Either it's not rendered (display:none parent) or has "hidden" class
    if (label) {
      expect(label.className).toContain("hidden");
    }
  });
});
