export type NativeTensorInput = {
  dtype: string;
  dims: number[];
  data: number[];
};

export type NativeInferenceOptions = {
  model_id: string;
  inputs?: Record<string, NativeTensorInput>;
  default_input?: NativeTensorInput;
  execution_provider?: string;
  warmup_iterations?: number;
  iterations?: number;
  batch_size?: number;
  include_outputs?: boolean;
  venv_family?: string;
};

export type NativeInferenceResult = {
  ok: boolean;
  error?: string;
  ep_used?: string;
  session_create_ms?: number;
  latencies_ms?: number[];
  avg_ms?: number;
  min_ms?: number;
  max_ms?: number;
  p50_ms?: number;
  p99_ms?: number;
  throughput_per_sec?: number;
  output_shapes?: string[];
  output_preview?: string;
};

export type NativeMode = "infer" | "benchmark";

export async function callNativePlayground(
  mode: NativeMode,
  opts: NativeInferenceOptions,
): Promise<NativeInferenceResult> {
  const endpoint = mode === "benchmark"
    ? "/api/playground/native/benchmark"
    : "/api/playground/native/infer";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });

  const data = (await res.json()) as NativeInferenceResult;
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `${mode} request failed with ${res.status}`);
  }
  return data;
}

export function nativeInfer(opts: NativeInferenceOptions): Promise<NativeInferenceResult> {
  return callNativePlayground("infer", opts);
}

export function nativeBenchmark(opts: NativeInferenceOptions): Promise<NativeInferenceResult> {
  return callNativePlayground("benchmark", opts);
}
