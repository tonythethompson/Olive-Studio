import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock, renderWithProviders } from "../__tests__/testUtils";

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

vi.mock("./PipelineReview", () => ({
  PipelineReview: () => <div data-testid="pipeline-review">PipelineReview</div>,
}));

import { AssistantSidebar } from "./AssistantSidebar";

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
};

describe("AssistantSidebar", () => {
  useFetchRoutesMock({
    "ai/providers": { providers: [] },
  });

  beforeAll(() => {
    // jsdom does not implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders when isOpen is true", async () => {
    await act(async () => {
      renderWithProviders(<AssistantSidebar {...defaultProps} />);
    });
    // Sidebar should be visible with tab content
    expect(screen.getByRole("tab", { name: /^Assistant$/ })).toBeTruthy();
    expect(screen.getByTestId("pipeline-review")).toBeTruthy();
  });

  it("renders tab navigation (assistant, settings, agent)", async () => {
    await act(async () => {
      renderWithProviders(<AssistantSidebar {...defaultProps} />);
    });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Assistant", "Settings", "Agent"]);
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    await act(async () => {
      renderWithProviders(<AssistantSidebar isOpen={true} onClose={onClose} />);
    });
    const closeButton = screen.getByRole("button", { name: /close sidebar/i });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders with controlled state props", async () => {
    const state = createMockUIState();
    await act(async () => {
      renderWithProviders(<AssistantSidebar {...defaultProps} state={state} setState={mockSetState} />);
    });
    expect(screen.getByRole("tab", { name: /^Assistant$/ })).toBeTruthy();
    expect(screen.getByTestId("pipeline-review")).toBeTruthy();
  });

  it("sets aria-hidden when isOpen is false", async () => {
    let container: HTMLElement | undefined;
    await act(async () => {
      const result = renderWithProviders(<AssistantSidebar {...defaultProps} isOpen={false} />);
      container = result.container;
    });
    // The sidebar uses aria-hidden + w-0 rather than conditional rendering
    const sidebar = container!.querySelector("[aria-hidden='true']");
    expect(sidebar).not.toBeNull();
  });

  it("renders the Agent tab panel with policy controls and no dropdown dialog", async () => {
    await act(async () => {
      renderWithProviders(<AssistantSidebar {...defaultProps} />);
    });

    const agentTab = screen.getByRole("tab", { name: /^Agent$/ });
    await act(async () => {
      fireEvent.click(agentTab);
    });

    const panel = document.getElementById("assistant-panel-agent");
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute("aria-labelledby")).toBe("assistant-tab-agent");

    // The embedded panel variant renders the policy toggles inline...
    expect(screen.getByText(/Agent \/ MCP access/i)).toBeTruthy();
    expect(screen.getByLabelText(/MCP access/i)).toBeTruthy();

    // ...and never the compact control's popover dialog.
    expect(screen.queryByRole("dialog", { name: /Agent and MCP access settings/i })).toBeNull();
  });

  it("compact sidebar: scrim dismiss, inert/aria-hidden, responsive classes, Escape", async () => {
    const onClose = vi.fn();
    let view: ReturnType<typeof renderWithProviders> | undefined;

    await act(async () => {
      view = renderWithProviders(<AssistantSidebar isOpen={true} onClose={onClose} />);
    });

    const openAside = view!.container.querySelector("#assistant-panel");
    expect(openAside).not.toBeNull();
    expect(openAside!.getAttribute("aria-hidden")).toBe("false");
    expect(openAside!.hasAttribute("inert")).toBe(false);
    expect(openAside!.className).toMatch(/max-wide:fixed/);
    expect(openAside!.className).toMatch(/wide:w-\[420px]/);

    const scrim = screen.getByRole("button", { name: /dismiss assistant/i });
    expect(scrim.className).toMatch(/wide:hidden/);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      view!.rerender(<AssistantSidebar isOpen={false} onClose={onClose} />);
    });

    const closedAside = view!.container.querySelector("#assistant-panel");
    expect(closedAside).not.toBeNull();
    expect(closedAside!.getAttribute("aria-hidden")).toBe("true");
    expect(closedAside!.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("button", { name: /dismiss assistant/i })).toBeNull();
  });
});
