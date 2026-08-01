import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock } from "./__tests__/testUtils";

// Mock the pipeline store
const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: createMockUIState(),
    setState: mockSetState,
  }),
}));

// Mock AI workspace context
vi.mock("@/lib/aiWorkspaceContext", () => ({
  buildAiWorkspaceContext: () => "mock context",
  buildChatPresetQueries: () => [],
  buildWorkspaceContextSummary: () => "summary",
}));

// Mock child components to isolate sidebar logic
vi.mock("./LocalModelManager", () => ({
  LocalModelManager: () => <div data-testid="local-model-manager">LocalModelManager</div>,
}));

vi.mock("./ProviderErrorBlock", () => ({
  ProviderErrorBlock: () => <div data-testid="provider-error-block">ProviderError</div>,
}));

vi.mock("./AuditPanel", () => ({
  AuditPanel: () => <div data-testid="audit-panel">AuditPanel</div>,
}));

import { GeminiSidebar } from "./GeminiSidebar";

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};

describe("GeminiSidebar", () => {
  useFetchRoutesMock({
    "ai/providers": { providers: [] },
  });

  beforeAll(() => {
    // jsdom does not implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders when isOpen is true", async () => {
    await act(async () => {
      render(<GeminiSidebar {...defaultProps} />);
    });
    // Sidebar should be visible with tab content
    expect(screen.getAllByText(/audit/i).length).toBeGreaterThan(0);
  });

  it("renders tab navigation (audit, chat, settings)", async () => {
    await act(async () => {
      render(<GeminiSidebar {...defaultProps} />);
    });
    expect(screen.getAllByText(/chat/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/settings/i).length).toBeGreaterThan(0);
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(<GeminiSidebar isOpen={true} onClose={onClose} />);
    });
    const closeButton = screen.getByRole("button", { name: /close sidebar/i });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders with controlled state props", async () => {
    const state = createMockUIState();
    await act(async () => {
      render(<GeminiSidebar {...defaultProps} state={state} setState={mockSetState} />);
    });
    expect(screen.getAllByText(/audit/i).length).toBeGreaterThan(0);
  });

  it("sets aria-hidden when isOpen is false", async () => {
    let container: HTMLElement | undefined;
    await act(async () => {
      const result = render(<GeminiSidebar {...defaultProps} isOpen={false} />);
      container = result.container;
    });
    // The sidebar uses aria-hidden + w-0 rather than conditional rendering
    const sidebar = container!.querySelector("[aria-hidden='true']");
    expect(sidebar).not.toBeNull();
  });

  it("compact sidebar: scrim dismiss, inert/aria-hidden, responsive classes, Escape", async () => {
    const onClose = vi.fn();
    let view: ReturnType<typeof render> | undefined;

    await act(async () => {
      view = render(<GeminiSidebar isOpen={true} onClose={onClose} />);
    });

    const openAside = view!.container.querySelector("#assistant-panel");
    expect(openAside).not.toBeNull();
    expect(openAside!.getAttribute("aria-hidden")).toBe("false");
    expect(openAside!.hasAttribute("inert")).toBe(false);
    expect(openAside!.className).toMatch(/max-wide:fixed/);
    expect(openAside!.className).toMatch(/wide:w-\[420px\]/);

    const scrim = screen.getByRole("button", { name: /dismiss assistant/i });
    expect(scrim.className).toMatch(/wide:hidden/);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      view!.rerender(<GeminiSidebar isOpen={false} onClose={onClose} />);
    });

    const closedAside = view!.container.querySelector("#assistant-panel");
    expect(closedAside).not.toBeNull();
    expect(closedAside!.getAttribute("aria-hidden")).toBe("true");
    expect(closedAside!.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("button", { name: /dismiss assistant/i })).toBeNull();
  });
});
