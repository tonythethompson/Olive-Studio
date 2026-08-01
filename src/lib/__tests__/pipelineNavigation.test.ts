// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attemptPipelineNavigate,
  navigatePipeline,
  OLIVE_PIPELINE_NAV_BLOCKED,
  OLIVE_PIPELINE_NAVIGATE,
  PIPELINE_NAV_BLOCKED_MESSAGE,
  setPipelineOliveRunning,
} from "@/lib/pipelineNavigation";

afterEach(() => {
  setPipelineOliveRunning(false);
});

describe("pipelineNavigation", () => {
  it("allows navigation when Olive is not running", () => {
    const navigate = vi.fn();
    const blocked = vi.fn();
    window.addEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.addEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);

    expect(attemptPipelineNavigate("ihv")).toBe(true);
    navigatePipeline("ihv");

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();

    window.removeEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.removeEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);
  });

  it("blocks non-execute navigation during an Olive run and announces why", () => {
    setPipelineOliveRunning(true);
    const navigate = vi.fn();
    const blocked = vi.fn();
    window.addEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.addEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);

    expect(attemptPipelineNavigate("ihv")).toBe(false);
    navigatePipeline("ihv");

    expect(navigate).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalled();
    const detail = (blocked.mock.calls.at(-1)?.[0] as CustomEvent).detail;
    expect(detail).toEqual({ id: "ihv", message: PIPELINE_NAV_BLOCKED_MESSAGE });

    window.removeEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.removeEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);
  });

  it("still allows execute navigation during an Olive run", () => {
    setPipelineOliveRunning(true);
    const navigate = vi.fn();
    const blocked = vi.fn();
    window.addEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.addEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);

    expect(attemptPipelineNavigate("execute")).toBe(true);
    navigatePipeline("execute");

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();

    window.removeEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.removeEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);
  });
});
