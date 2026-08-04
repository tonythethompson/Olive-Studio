import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelCombobox } from "./ModelCombobox";

describe("ModelCombobox", () => {
  const options = [
    { id: "openrouter/google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "openrouter/openai/gpt-4o", label: "GPT-4o" },
  ];

  it("lists all models on open even when a model is already selected", () => {
    render(
      <ModelCombobox
        value="openrouter/openai/gpt-4o"
        options={options}
        modelsSource="live"
        onChange={vi.fn()}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /GPT-4o/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Gemini 2.5 Pro/ })).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe(
      "openrouter/openai/gpt-4o",
    );
  });

  it("filters only after the user types", () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox
        value="openrouter/openai/gpt-4o"
        options={options}
        modelsSource="live"
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("combobox", { name: "AI model" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "gemini" } });
    expect(onChange).toHaveBeenCalledWith("gemini");
    expect(screen.getByRole("option", { name: /Gemini 2.5 Pro/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /GPT-4o/ })).toBeNull();
  });

  it("soft-warns when a freehand id is missing from the live catalog", () => {
    render(
      <ModelCombobox
        value="my-org/custom-model"
        options={options}
        modelsSource="live"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Model ID not recognized. Requests may fail.")).toBeTruthy();
  });
});
