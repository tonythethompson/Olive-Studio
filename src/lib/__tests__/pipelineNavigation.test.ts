// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attemptPipelineNavigate,
  expandPipelineValidation,
  emphasizeValidationPanel,
  isPipelineViewId,
  navigatePipeline,
  OLIVE_PIPELINE_NAV_BLOCKED,
  OLIVE_PIPELINE_NAVIGATE,
  OLIVE_EXPAND_VALIDATION,
  PIPELINE_NAV_BLOCKED_MESSAGE,
  setPipelineOliveRunning,
  takePendingExpandValidation,
  takePendingEmphasizeValidation,
} from "@/lib/pipelineNavigation";

afterEach(() => {
  setPipelineOliveRunning(false);
  takePendingExpandValidation();
  takePendingEmphasizeValidation();
});

describe("pipelineNavigation", () => {
  it("recognizes playground as a valid pipeline view id", () => {
    expect(isPipelineViewId("playground")).toBe(true);
    expect(isPipelineViewId("unknown")).toBe(false);
    expect(isPipelineViewId(null)).toBe(false);
  });

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

  it("still allows playground navigation during an Olive run", () => {
    setPipelineOliveRunning(true);
    const navigate = vi.fn();
    const blocked = vi.fn();
    window.addEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.addEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);

    expect(attemptPipelineNavigate("playground")).toBe(true);
    navigatePipeline("playground");

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();

    window.removeEventListener(OLIVE_PIPELINE_NAVIGATE, navigate);
    window.removeEventListener(OLIVE_PIPELINE_NAV_BLOCKED, blocked);
  });

  it("keeps expand requests pending when no listener is registered yet", () => {
    expandPipelineValidation();
    expect(takePendingExpandValidation()).toBe(true);
    expect(takePendingExpandValidation()).toBe(false);
  });

  it("clears pending expand when a live listener handles the event", () => {
    const listener = () => {
      takePendingExpandValidation();
    };
    window.addEventListener(OLIVE_EXPAND_VALIDATION, listener);
    expandPipelineValidation();
    expect(takePendingExpandValidation()).toBe(false);
    window.removeEventListener(OLIVE_EXPAND_VALIDATION, listener);
  });

  it("keeps emphasize requests pending when no listener is registered yet", () => {
    emphasizeValidationPanel();
    expect(takePendingEmphasizeValidation()).toBe(true);
    expect(takePendingEmphasizeValidation()).toBe(false);
  });
});
