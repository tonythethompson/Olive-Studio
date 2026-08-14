import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const drive = vi.fn();
  const destroy = vi.fn();
  const moveNext = vi.fn();
  const getActiveStep = vi.fn(() => ({ data: { id: "overview" } }));
  const driverFactory = vi.fn((config: Record<string, unknown>) => ({
    drive,
    destroy,
    moveNext,
    getActiveStep,
    config,
  }));
  return { drive, destroy, moveNext, getActiveStep, driverFactory };
});

vi.mock("driver.js", () => ({ driver: mocks.driverFactory }));

import tourDemoRecipe from "@/data/tour-demo-recipe.json";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import { setPipelineOliveRunning } from "@/lib/pipelineNavigation";
import { hasSelectedModel } from "@/lib/pipelineValidation";
import { createDefaultPipelineState, usePipelineStore } from "@/lib/stores/pipelineStore";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";
import { ensureTourDemoModel, startGuidedTour, TOUR_STEPS } from "./tour";

describe("tour demo recipe", () => {
  it("derives a selected Hugging Face model on CPU with conversion enabled", () => {
    const derived = deriveUiStateFromOliveRecipe(tourDemoRecipe, { replacePasses: true });
    const state = {
      ...createDefaultPipelineState(),
      ...derived,
      passes: { ...createDefaultPipelineState().passes, ...derived.passes },
    };
    expect(hasSelectedModel(state)).toBe(true);
    expect(state.hfModelId).toBe("sshleifer/tiny-gpt2");
    expect(state.modelSource).toBe("huggingface");
    expect(state.ihvProvider).toBe("CPUExecutionProvider");
    expect(state.passes.conversion).toBe(true);
  });
});

describe("ensureTourDemoModel", () => {
  beforeEach(() => {
    usePipelineStore.getState().resetState();
  });

  it("applies the sample recipe when no model is selected", () => {
    const result = ensureTourDemoModel();
    expect(result.applied).toBe(true);
    const state = usePipelineStore.getState().state;
    expect(hasSelectedModel(state)).toBe(true);
    expect(state.hfModelId).toBe("sshleifer/tiny-gpt2");
  });

  it("does not overwrite an already selected model", () => {
    usePipelineStore.getState().setState({ hfModelId: "microsoft/phi-2" });
    const result = ensureTourDemoModel();
    expect(result.applied).toBe(false);
    expect(usePipelineStore.getState().state.hfModelId).toBe("microsoft/phi-2");
  });

  it("is a no-op the second time after a successful apply", () => {
    expect(ensureTourDemoModel().applied).toBe(true);
    expect(ensureTourDemoModel().applied).toBe(false);
    expect(usePipelineStore.getState().state.hfModelId).toBe("sshleifer/tiny-gpt2");
  });
});

describe("TOUR_STEPS", () => {
  it("starts with an unanchored Olive overview, then real controls", () => {
    expect(TOUR_STEPS).toHaveLength(8);
    expect(TOUR_STEPS[0]!.element).toBeUndefined();
    expect(TOUR_STEPS[0]!.data).toEqual({ id: "overview" });
    expect(TOUR_STEPS.map((s) => s.element).slice(1)).toEqual([
      'nav[aria-label="Pipeline"]',
      '[data-tour="model-source"]',
      '[data-tour="hardware-providers"]',
      '[data-tour="recipe-graph"]',
      "#playground-heading",
      '[data-tour="assistant"]',
      '[data-tour="settings"]',
    ]);
  });

  it("enables click-to-advance on interaction steps and waits for gated panels", () => {
    const byId = Object.fromEntries(TOUR_STEPS.map((s) => [s.data?.id, s]));
    expect(byId.overview?.advanceOnClick).toBeFalsy();
    expect(byId.pipeline?.advanceOnClick).toBe(true);
    expect(byId["model-source"]?.advanceOnClick).toBeFalsy();
    expect(byId.hardware?.advanceOnClick).toBe(true);
    expect(byId.hardware?.waitForElement).toBe(4000);
    expect(byId.recipe?.advanceOnClick).toBe(true);
    expect(byId.recipe?.waitForElement).toBe(4000);
    expect(byId.assistant?.advanceOnClick).toBe(true);
  });

  it("gives every step a title and description without em or en dashes", () => {
    for (const step of TOUR_STEPS) {
      const title = step.popover?.title ?? "";
      const description = step.popover?.description ?? "";
      expect(title.length).toBeGreaterThan(0);
      expect(description.length).toBeGreaterThan(0);
      expect(title + description).not.toMatch(/[—–]/);
    }
  });

  it("explains Olive the toolkit in the first step", () => {
    const text = `${TOUR_STEPS[0]!.popover?.title} ${TOUR_STEPS[0]!.popover?.description}`.toLowerCase();
    expect(text).toContain("olive");
    expect(text).toMatch(/onnx|quantiz|cpu|gpu|npu/);
  });
});

describe("startGuidedTour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveStep.mockReturnValue({ data: { id: "overview" } });
    usePipelineStore.getState().resetState();
  });

  it("enables keyboard control and drives immediately", () => {
    startGuidedTour(() => {});
    expect(mocks.driverFactory).toHaveBeenCalledTimes(1);
    expect(mocks.driverFactory.mock.calls[0][0]).toMatchObject({
      steps: TOUR_STEPS,
      allowKeyboardControl: true,
    });
    expect(mocks.drive).toHaveBeenCalledTimes(1);
  });

  it("applies the sample recipe when Next is pressed on Model source with an empty workspace", () => {
    mocks.getActiveStep.mockReturnValue({ data: { id: "model-source" } });
    startGuidedTour(() => {});
    const config = mocks.driverFactory.mock.calls[0][0] as {
      onNextClick: () => void;
    };
    config.onNextClick();
    expect(usePipelineStore.getState().state.hfModelId).toBe("sshleifer/tiny-gpt2");
    expect(mocks.moveNext).toHaveBeenCalledTimes(1);
  });

  it("does not clobber an existing model when Next is pressed on Model source", () => {
    usePipelineStore.getState().setState({ hfModelId: "microsoft/phi-2" });
    mocks.getActiveStep.mockReturnValue({ data: { id: "model-source" } });
    startGuidedTour(() => {});
    const config = mocks.driverFactory.mock.calls[0][0] as { onNextClick: () => void };
    config.onNextClick();
    expect(usePipelineStore.getState().state.hfModelId).toBe("microsoft/phi-2");
    expect(mocks.moveNext).toHaveBeenCalledTimes(1);
  });

  it("returns null and does not mutate state while an Olive job is running", () => {
    setPipelineOliveRunning(true);
    try {
      const result = startGuidedTour(() => {});
      expect(result).toBeNull();
      expect(mocks.driverFactory).not.toHaveBeenCalled();
      expect(usePipelineStore.getState().state.hfModelId).toBe("");
    } finally {
      setPipelineOliveRunning(false);
    }
  });

  it("settles exactly once on destroy, whether finished or skipped", () => {
    const onSettled = vi.fn();
    startGuidedTour(onSettled);
    const config = mocks.driverFactory.mock.calls[0][0] as { onDestroyStarted: () => void };
    config.onDestroyStarted();
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("guided tour preference", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ tourSeen: false });
  });

  it("defaults tourSeen to false and persists it via markTourSeen", () => {
    expect(usePreferencesStore.getState().tourSeen).toBe(false);
    usePreferencesStore.getState().markTourSeen();
    expect(usePreferencesStore.getState().tourSeen).toBe(true);
  });

  it("no longer exposes welcomeDismissed", () => {
    expect(usePreferencesStore.getState()).not.toHaveProperty("welcomeDismissed");
    expect(usePreferencesStore.getState()).not.toHaveProperty("dismissWelcome");
    expect(usePreferencesStore.getState().tourSeen).toBe(false);
  });
});
