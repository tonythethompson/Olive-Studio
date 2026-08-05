import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProviderErrorBlock } from "./ProviderErrorBlock";

describe("ProviderErrorBlock", () => {
  it("renders provider-not-configured UI for API key errors", () => {
    const onGoSettings = vi.fn();
    render(
      <ProviderErrorBlock
        msg="No AI provider configured. Add an API key in Settings."
        onGoSettings={onGoSettings}
      />,
    );

    // Header
    expect(screen.getByText("No AI Provider Configured")).toBeDefined();

    // "Settings tab" link
    const settingsLink = screen.getByText("Settings tab");
    expect(settingsLink).toBeDefined();

    // Clicking the link calls onGoSettings
    fireEvent.click(settingsLink);
    expect(onGoSettings).toHaveBeenCalledTimes(1);
  });

  it("renders provider error for 401 errors", () => {
    render(<ProviderErrorBlock msg="401 Unauthorized — check your API key" onGoSettings={vi.fn()} />);
    expect(screen.getByText("No AI Provider Configured")).toBeDefined();
  });

  it("renders provider error for 403 errors", () => {
    render(<ProviderErrorBlock msg="403 Forbidden" onGoSettings={vi.fn()} />);
    expect(screen.getByText("No AI Provider Configured")).toBeDefined();
  });

  it("renders provider error for 'not configured' messages", () => {
    render(<ProviderErrorBlock msg="Provider not configured" onGoSettings={vi.fn()} />);
    expect(screen.getByText("No AI Provider Configured")).toBeDefined();
  });

  it("renders provider error for 'API route not found' messages", () => {
    render(<ProviderErrorBlock msg="API route not found" onGoSettings={vi.fn()} />);
    expect(screen.getByText("No AI Provider Configured")).toBeDefined();
  });

  it("renders generic error for non-provider errors", () => {
    render(<ProviderErrorBlock msg="Something went wrong during optimization" onGoSettings={vi.fn()} />);

    // Generic error does NOT show "No AI Provider Configured" header
    expect(screen.queryByText("No AI Provider Configured")).toBeNull();

    // Shows "Error" label
    expect(screen.getByText("Error")).toBeDefined();

    // Shows the message
    expect(screen.getByText("Something went wrong during optimization")).toBeDefined();
    expect(screen.getByText(/verify the configured endpoint/i)).toBeDefined();
  });

  it("does not treat Unexpected token text as a model JSON classification", () => {
    render(<ProviderErrorBlock msg="Unexpected token < in JSON at position 0" onGoSettings={vi.fn()} />);
    expect(screen.queryByText("Model returned invalid JSON")).toBeNull();
    expect(screen.queryByText(/connection is fine/i)).toBeNull();
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText(/verify the configured endpoint/i)).toBeDefined();
  });

  it("shows model JSON guidance only when kind is structured", () => {
    render(
      <ProviderErrorBlock
        msg="AI response was not valid JSON"
        kind="invalid_model_json"
        onGoSettings={vi.fn()}
      />,
    );
    expect(screen.getByText("Model returned invalid JSON")).toBeDefined();
    expect(screen.queryByText(/connection is fine/i)).toBeNull();
  });

  it("shows env var hints for provider errors", () => {
    render(<ProviderErrorBlock msg="No AI provider configured" onGoSettings={vi.fn()} />);

    // Should mention key env vars in the hint text
    expect(screen.getByText(/GEMINI_API_KEY/)).toBeDefined();
    expect(screen.getByText(/OPENAI_API_KEY/)).toBeDefined();
    expect(screen.getByText(/ANTHROPIC_API_KEY/)).toBeDefined();
    expect(screen.getByText(/XAI_API_KEY/)).toBeDefined();
  });
});
