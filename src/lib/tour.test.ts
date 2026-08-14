import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const drive = vi.fn();
  const destroy = vi.fn();
  const driverFactory = vi.fn((config: Record<string, unknown>) => ({ drive, destroy, config }));
  return { drive, destroy, driverFactory };
});

vi.mock("driver.js", () => ({ driver: mocks.driverFactory }));

import { TOUR_STEPS, startGuidedTour } from "./tour";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";

describe("TOUR_STEPS", () => {
  it("walks the pipeline in order, then the header affordances", () => {
    expect(TOUR_STEPS.map((s) => s.element)).toEqual([
      'nav[aria-label="Pipeline"]',
      "#input-heading",
      "#ihv-heading",
      "#execute-heading",
      "#playground-heading",
      '[data-tour="assistant"]',
      '[data-tour="settings"]',
    ]);
  });

  it("gives every step a title and description", () => {
    for (const step of TOUR_STEPS) {
      expect(step.popover?.title).toBeTruthy();
      expect(step.popover?.description).toBeTruthy();
    }
  });
});

describe("startGuidedTour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drives the configured steps immediately", () => {
    startGuidedTour(() => {});
    expect(mocks.driverFactory).toHaveBeenCalledTimes(1);
    expect(mocks.driverFactory.mock.calls[0][0]).toMatchObject({ steps: TOUR_STEPS });
    expect(mocks.drive).toHaveBeenCalledTimes(1);
  });

  it("settles exactly once on destroy, whether finished or skipped", () => {
    const onSettled = vi.fn();
    startGuidedTour(onSettled);
    const config = mocks.driverFactory.mock.calls[0][0];
    (config.onDestroyStarted as () => void)();
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
});
