/**
 * Shared test utilities for component tests.
 *
 * Provides helpers for mocking the pipeline store and fetch routes,
 * following the patterns established in LocalModelManager.test.tsx.
 */
import { vi, beforeEach, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UIState } from "@/types";

/**
 * Renders with a fresh QueryClient per call — required for any component
 * that calls a `@tanstack/react-query` hook (e.g. useHardwareProbe). Retries
 * are disabled so failed queries settle immediately instead of stalling tests.
 *
 * Uses RTL's `wrapper` option (not manual JSX nesting) so the QueryClient
 * survives `rerender()` calls too — rerender replaces the root element passed
 * to it, which would otherwise drop a manually-nested provider.
 */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(ui, { wrapper: Wrapper, ...options });
}

/**
 * Creates a complete default UI state for isolated component tests.
 *
 * @param partial - Optional UI state fields that override the defaults
 * @returns A complete UI state
 */
export function createMockUIState(partial?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    hfTask: "",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider",
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    passes: {
      conversion: true,
      conversionFormat: "onnx",
      conversionSourceFormat: "pytorch",
      quantization: false,
      quantizationMethod: "gptq",
      pruning: false,
      lora: false,
      ortTransformers: false,
      outputName: "model",
      trustRemoteCode: false,
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
