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

  it("does not commit a different model on focus + Enter for freehand ids", () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox
        value="my-org/custom-model"
        options={options}
        modelsSource="live"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not commit a different model on focus + Enter when selection is past the visible window", () => {
    const many = Array.from({ length: 45 }, (_, i) => ({
      id: `model-${i}`,
      label: `Model ${i}`,
    }));
    const onChange = vi.fn();
    render(
      <ModelCombobox value="model-42" options={many} modelsSource="live" onChange={onChange} />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not overwrite a freehand id with the first filter match on Enter", () => {
    const onChange = vi.fn();
    render(
      <ModelCombobox
        value=""
        options={[
          { id: "openai/gpt-4o", label: "GPT-4o" },
          { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
        ]}
        modelsSource="live"
        onChange={onChange}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "openai/gpt-4o-my-ft" } });
    expect(onChange).toHaveBeenLastCalledWith("openai/gpt-4o-my-ft");
    onChange.mockClear();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("openai/gpt-4o-my-ft");
  });

  it("closes the list when focus leaves via Tab", () => {
    render(
      <ModelCombobox
        value="openrouter/openai/gpt-4o"
        options={options}
        modelsSource="live"
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
