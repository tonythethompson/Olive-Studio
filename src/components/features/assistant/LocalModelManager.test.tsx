import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { LocalModelManager } from "./LocalModelManager";

// ── Mock fetch with proper spy cleanup ─────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function mockFetch(
  overrides: {
    lms?: { installedModels?: string[]; loadedModels?: string[]; error?: string };
    ollama?: { installedModels?: string[]; runningModels?: string[]; error?: string };
  } = {},
): void {
  const lms = overrides.lms ?? {};
  const ollama = overrides.ollama ?? {};

  fetchSpy.mockImplementation((url: unknown) => {
    const urlStr = String(url);
    if (urlStr.includes("ollama-models")) {
      if (ollama.error) {
        return Promise.resolve(new Response(JSON.stringify({ error: ollama.error }), { status: 500 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            installedModels: ollama.installedModels ?? [],
            runningModels: ollama.runningModels ?? [],
          }),
          { status: 200 },
        ),
      );
    }
    // Default: /api/ai/local-models
    if (lms.error) {
      return Promise.resolve(new Response(JSON.stringify({ error: lms.error }), { status: 500 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          installedModels: lms.installedModels ?? [],
          loadedModels: lms.loadedModels ?? [],
        }),
        { status: 200 },
      ),
    );
  });
}

// ── 1. Empty / loading states ───────────────────────────────────────────────

describe("LocalModelManager — empty states", () => {
  it("shows empty hint when no models and not loading", async () => {
    mockFetch();

    await act(async () => {
      render(<LocalModelManager isOpen emptyHint="No models yet." />);
    });

    await waitFor(() => {
      expect(screen.getByText("No models yet.")).toBeTruthy();
    });
  });

  it("shows refreshing text while loading", async () => {
    // Return a never-resolving promise to keep loading true
    fetchSpy.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    expect(screen.getByText("Refreshing…")).toBeDefined();
  });
});

// ── 2. Models display ────────────────────────────────────────────────────────

describe("LocalModelManager — models display", () => {
  it("renders model list when models are loaded", async () => {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/Llama-3.1-8B-Instruct", "meta-llama/Llama-3.1-1B-Instruct"],
        loadedModels: [],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    await waitFor(() => {
      expect(screen.getByText("Installed Models")).toBeDefined();
    });

    expect(screen.getByText("meta-llama")).toBeDefined();
    expect(screen.getByText("Llama-3.1-8B-Instruct")).toBeDefined();
    expect(screen.getByText("Llama-3.1-1B-Instruct")).toBeDefined();
  });

  it("renders Load & enable for unloaded models", async () => {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/Llama-3.1-8B-Instruct"],
        loadedModels: [],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    await waitFor(() => {
      expect(screen.getByText("Load & enable")).toBeDefined();
    });
  });

  it("shows Enable and Unload for loaded models that are not active", async () => {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/TinyModel"],
        loadedModels: ["meta-llama/TinyModel"],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    await waitFor(() => {
      expect(screen.getByText("Unload")).toBeDefined();
      expect(screen.getByText("Enable")).toBeDefined();
    });
  });

  it("shows Active badge and hides Enable for the active model", async () => {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/TinyModel"],
        loadedModels: ["meta-llama/TinyModel"],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen activeModel="meta-llama/TinyModel" />);
    });

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeDefined();
      expect(screen.queryByText("Enable")).toBeNull();
      expect(screen.queryByText("Load & enable")).toBeNull();
    });
  });
});

// ── 3. Search filtering ─────────────────────────────────────────────────────

describe("LocalModelManager — search filtering", () => {
  /** Render with the shared 4-model fixture and wait for the list to appear. */
  async function renderWithSearchFixture(): Promise<void> {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/Alpha", "meta-llama/Beta", "mistralai/Gamma", "google/Delta"],
        loadedModels: [],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeDefined();
    });
  }

  it("shows search input when more than one model is installed", async () => {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/A", "meta-llama/B"],
        loadedModels: [],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search installed models…")).toBeDefined();
    });
  });

  it("filters models by search query", async () => {
    await renderWithSearchFixture();

    const input = screen.getByPlaceholderText("Search installed models…");
    fireEvent.change(input, { target: { value: "Beta" } });

    expect(screen.getByText("Beta")).toBeDefined();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Gamma")).toBeNull();
  });

  it("shows no-match message when search yields no results", async () => {
    await renderWithSearchFixture();

    const input = screen.getByPlaceholderText("Search installed models…");
    fireEvent.change(input, { target: { value: "ZzzNotExist" } });

    expect(screen.getByText(/No models match/)).toBeDefined();
  });

  it("clears search on Escape key", async () => {
    await renderWithSearchFixture();

    const input = screen.getByPlaceholderText("Search installed models…");
    fireEvent.change(input, { target: { value: "Alpha" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByText("Beta")).toBeDefined();
    });
  });
});

// ── 4. Publisher collapse toggle ─────────────────────────────────────────────

describe("LocalModelManager — publisher groups", () => {
  it("toggles publisher group collapse on click", async () => {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/Model1", "mistralai/Model2"],
        loadedModels: [],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    await waitFor(() => {
      expect(screen.getByText("meta-llama")).toBeDefined();
      expect(screen.getByText("Model1")).toBeDefined();
    });

    fireEvent.click(screen.getByText("meta-llama"));
    expect(screen.queryByText("Model1")).toBeNull();

    fireEvent.click(screen.getByText("meta-llama"));
    expect(screen.getByText("Model1")).toBeDefined();
  });
});

// ── 5. Keyboard shortcut ─────────────────────────────────────────────────────

describe("LocalModelManager — keyboard shortcut", () => {
  it("Cmd+K focuses search input when sidebar is open", async () => {
    mockFetch({
      lms: {
        installedModels: ["meta-llama/A", "meta-llama/B", "mistralai/C", "google/D"],
        loadedModels: [],
      },
    });

    await act(async () => {
      render(<LocalModelManager isOpen />);
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search installed models…")).toBeDefined();
    });

    const input = screen.getByPlaceholderText("Search installed models…");
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("does not crash when Cmd+K is used while sidebar is closed", async () => {
    mockFetch();

    await act(async () => {
      render(<LocalModelManager isOpen={false} />);
    });

    // No crash
    fireEvent.keyDown(window, { key: "k", metaKey: true });
  });
});
