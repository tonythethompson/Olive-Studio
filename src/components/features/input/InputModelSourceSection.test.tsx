import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createMockUIState } from "../__tests__/testUtils";
import { InputModelSourceSection } from "./InputModelSourceSection";

function Harness({ startExpanded = false }: { startExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(startExpanded);
  const state = createMockUIState({ modelSource: "local" });
  return (
    <InputModelSourceSection
      state={state}
      setState={vi.fn()}
      appliedRecipeLabel={null}
      recipeRailCollapsed={false}
      sourceConfigExpanded={expanded}
      setSourceConfigExpanded={setExpanded}
      hfTokenInput=""
      setHfTokenInput={vi.fn()}
      hfTokenStatus="none"
      isTokenMutating={false}
      submitTokenMutation={{ isPending: false }}
      clearTokenMutation={{ isPending: false, isError: false }}
      handleSubmitToken={vi.fn()}
      handleClearToken={vi.fn()}
      onConfigTextChange={vi.fn()}
    />
  );
}

describe("InputModelSourceSection mount latch", () => {
  it("keeps the local upload tree mounted after Hide", () => {
    render(<Harness />);
    expect(screen.queryByRole("heading", { name: /Source config/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Configure model source/i }));
    expect(screen.getByRole("heading", { name: /Source config/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Local/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Hide/i }));
    expect(screen.getByRole("button", { name: /Configure model source/i })).toBeTruthy();
    // Hidden, but still in the document so LocalFileUpload File refs survive.
    expect(screen.getByRole("heading", { name: /Source config/i, hidden: true })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Local/i, hidden: true })).toBeTruthy();
  });
});
