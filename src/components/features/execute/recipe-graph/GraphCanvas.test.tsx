import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockUIState } from "../../__tests__/testUtils";
import { GraphCanvas } from "./GraphCanvas";

describe("GraphCanvas", () => {
  it("supports node selection, keyboard navigation, and layout recalculation", () => {
    const onSelectNode = vi.fn();
    const props = {
      state: createMockUIState(),
      selectedNodeId: "input",
      onSelectNode,
      layoutTick: 0,
      onLayoutTick: vi.fn(),
    };
    const view = render(<GraphCanvas {...props} />);

    fireEvent.click(view.getByRole("button", { name: /target device/i }));
    expect(onSelectNode).toHaveBeenCalledWith("provider");

    fireEvent.keyDown(view.getByRole("button", { name: /model input/i }), {
      key: "ArrowRight",
    });
    expect(onSelectNode).toHaveBeenCalledWith("splitting");

    fireEvent(window, new Event("resize"));
    expect(props.onLayoutTick).toHaveBeenCalled();
  });
});
