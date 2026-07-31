/**
 * Shared test utilities for component tests.
 *
 * Provides helpers for mocking the pipeline store and fetch routes,
 * following the patterns established in LocalModelManager.test.tsx.
 */
import { vi, beforeEach, afterEach } from "vitest";
import type { UIState } from "@/types";

/** Minimal valid UIState for rendering components in isolation. */
export function createMockUIState(partial?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    passes: {
      conversion: true,
      conversionSourceFormat: "pytorch",
      quantization: false,
      quantizationMethod: "gptq",
      pruning: false,
      lora: false,
      ortTransformers: false,
      outputName: "model",
    },
    ...partial,
  } as UIState;
}

/**
 * Creates a fetch spy that routes requests by URL substring matching.
 *
 * @param routes - Map of URL substring → response body (serialized as JSON)
 * @returns The fetch spy (call .mockRestore() in afterEach)
 */
export function mockFetchRoutes(routes: Record<string, unknown> = {}) {
  const spy = vi.spyOn(globalThis, "fetch");
  spy.mockImplementation((url: unknown) => {
    const urlStr = String(url);
    for (const [pattern, body] of Object.entries(routes)) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  return spy;
}

/** Wires beforeEach/afterEach to install and restore a fetch mock for the given routes. */
export function useFetchRoutesMock(routes: Record<string, unknown> = {}) {
  let spy: ReturnType<typeof mockFetchRoutes>;
  beforeEach(() => {
    spy = mockFetchRoutes(routes);
  });
  afterEach(() => {
    spy.mockRestore();
    vi.clearAllMocks();
  });
}
