import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockUIState } from "../../__tests__/testUtils";
import { GraphCanvas } from "./GraphCanvas";
import { ARROW_MARKER_ID, PIPELINE_DOT_SYMBOL_ID, WIRE_GRADIENT_ID } from "./svgDefs";

describe("GraphCanvas SVG definitions", () => {
  it("deduplicates definitions, references shared geometry, and preserves interaction", () => {
    const onSelectNode = vi.fn();
    const props = {
      state: createMockUIState(),
      selectedNodeId: "input",
      onSelectNode,
      showDot: true,
      layoutTick: 0,
      onLayoutTick: vi.fn(),
    };
    const view = render(<GraphCanvas {...props} />);

    // The first render establishes the container ref; the next draws connections.
    view.rerender(<GraphCanvas {...props} layoutTick={1} />);

    const svg = view.container.querySelector("svg.absolute");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("defs")).toHaveLength(1);
    expect(svg?.querySelectorAll(`#${WIRE_GRADIENT_ID}`)).toHaveLength(1);
    expect(svg?.querySelectorAll(`#${ARROW_MARKER_ID}`)).toHaveLength(1);
    expect(svg?.querySelectorAll(`#${PIPELINE_DOT_SYMBOL_ID}`)).toHaveLength(1);

    const definitionIds = Array.from(
      svg?.querySelectorAll("linearGradient[id], marker[id], symbol[id]") ?? [],
      (element) => element.id,
    );
    expect(new Set(definitionIds).size).toBe(definitionIds.length);
    expect(svg?.querySelector(`path[marker-end="url(#${ARROW_MARKER_ID})"]`)).not.toBeNull();
    expect(svg?.querySelector(`use[href="#${PIPELINE_DOT_SYMBOL_ID}"]`)).not.toBeNull();

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
