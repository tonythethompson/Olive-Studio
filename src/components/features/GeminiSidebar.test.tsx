import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("renders when isOpen is true", () => {
    render(<GeminiSidebar {...defaultProps} />);
    // Sidebar should be visible with tab content
    expect(screen.getAllByText(/audit/i).length).toBeGreaterThan(0);
  });

  it("renders tab navigation (audit, chat, settings)", () => {
    render(<GeminiSidebar {...defaultProps} />);
    expect(screen.getAllByText(/chat/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/settings/i).length).toBeGreaterThan(0);
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<GeminiSidebar isOpen={true} onClose={onClose} />);
    // The close button is an icon-only <button> with <X /> — find via getAllByRole
    const buttons = screen.getAllByRole("button");
    // First button in the sidebar header is the dismiss (X) control
    const closeButton = buttons[0];
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders with controlled state props", () => {
    const state = createMockUIState();
    render(<GeminiSidebar {...defaultProps} state={state} setState={mockSetState} />);
    expect(screen.getAllByText(/audit/i).length).toBeGreaterThan(0);
  });

  it("sets aria-hidden when isOpen is false", () => {
    const { container } = render(<GeminiSidebar {...defaultProps} isOpen={false} />);
    // The sidebar uses aria-hidden + w-0 rather than conditional rendering
    const sidebar = container.querySelector("[aria-hidden='true']");
    expect(sidebar).not.toBeNull();
  });
});
