import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RuntimeEnvControls } from "./RuntimeEnvControls";

const missingLinux = {
  venvExists: false,
  venvPython: null,
  venvScripts: "/tmp/.venv/bin",
  oliveInstalled: false,
  oliveVersion: null,
  systemPython: null,
  configuredPython: null,
  venvOnUserPath: false,
  platform: "linux",
  hint: "No system Python found.",
  pythonPrerequisite: {
    downloadUrl: "https://www.python.org/downloads/",
    canAutoInstall: false,
    autoInstallLabel: null,
    command: "sudo apt update && sudo apt install -y python3 python3-venv python3-pip",
  },
};

const missingWindows = {
  ...missingLinux,
  platform: "win32",
  pythonPrerequisite: {
    downloadUrl: "https://www.python.org/downloads/windows/",
    canAutoInstall: true,
    autoInstallLabel: "Install Python 3.12",
    command: "winget install -e --id Python.Python.3.12",
  },
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

describe("RuntimeEnvControls Python prerequisite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a download link and Linux install command when Python is missing", async () => {
    stubRuntime(missingLinux);
    render(<RuntimeEnvControls />);
    fireEvent.click(screen.getByRole("button", { name: /Python \/ Olive runtime/i }));

    const link = await screen.findByRole("link", { name: /Download Python 3.12/i });
    expect(link.getAttribute("href")).toBe("https://www.python.org/downloads/");
    expect(screen.getByDisplayValue(/sudo apt install/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Install Python 3.12/i })).toBeNull();
  });

  it("offers one-click install on Windows when Python is missing", async () => {
    stubRuntime(missingWindows);
    render(<RuntimeEnvControls />);
    fireEvent.click(screen.getByRole("button", { name: /Python \/ Olive runtime/i }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Download Python 3.12/i }).getAttribute("href")).toBe(
        "https://www.python.org/downloads/windows/",
      );
    });
    expect(screen.getByRole("button", { name: /Install Python 3.12/i })).toBeTruthy();
  });
});
