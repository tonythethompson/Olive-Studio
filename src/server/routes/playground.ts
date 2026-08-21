/**
 * Native Playground route handlers.
 */
import type { Request, Response, Router } from "express";
import { arenaLocalOnly } from "../middleware/localOnly.ts";
import { parseBody, isParseBodyError } from "../middleware/bodyGuard.ts";
import {
  buildNativeRequest,
  resolveNativeModel,
  runNativeSidecar,
  type NativeResponse,
} from "../services/playground/nativeInference.ts";
import type { VenvFamily } from "../../lib/venvFamily.ts";

export function mountPlaygroundRoutes(router: Router): void {
  router.post(
    "/playground/native/infer",
    arenaLocalOnly,
    handleNativeRun,
  );

  router.post(
    "/playground/native/benchmark",
    arenaLocalOnly,
    handleNativeRun,
  );

  router.get("/playground/native/sidecar-status", arenaLocalOnly, (_req, res) => {
    res.json({ available: true, ort_dylib_required: true });
  });
}

type NativeRunBody = {
  model_id: string;
  inputs: Record<string, unknown>;
  execution_provider?: string;
  warmup_iterations?: number;
  iterations?: number;
  batch_size?: number;
  include_outputs?: boolean;
  venv_family?: string;
};

const nativeRunBodySpec = {
  model_id: { type: "string" as const },
  inputs: { type: "object" as const },
  execution_provider: { type: "string" as const, required: false },
  warmup_iterations: { type: "number" as const, required: false },
  iterations: { type: "number" as const, required: false },
  batch_size: { type: "number" as const, required: false },
  include_outputs: { type: "boolean" as const, required: false },
  venv_family: { type: "string" as const, required: false },
};

function coerceInputs(
  raw: Record<string, unknown>,
): Record<string, { dtype: string; dims: number[]; data: number[] }> {
  const inputs: Record<string, { dtype: string; dims: number[]; data: number[] }> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`input "${name}" must be an object`);
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.dtype !== "string") {
      throw new Error(`input "${name}" must have a string "dtype"`);
    }
    if (!Array.isArray(obj.dims) || !obj.dims.every((d) => typeof d === "number")) {
      throw new Error(`input "${name}" must have a numeric array "dims"`);
    }
    if (!Array.isArray(obj.data) || !obj.data.every((d) => typeof d === "number")) {
      throw new Error(`input "${name}" must have a numeric array "data"`);
    }
    inputs[name] = {
      dtype: obj.dtype,
      dims: obj.dims as number[],
      data: obj.data as number[],
    };
  }
  return inputs;
}

function getVenvFamily(raw: string | undefined): VenvFamily | undefined {
  if (!raw) return undefined;
  // Server trusts the narrow VenvFamily type but still validates against a known set.
  const allowed: VenvFamily[] = ["default", "cuda", "openvino", "qnn"];
  if (!allowed.includes(raw as VenvFamily)) {
    throw new Error(`unsupported venv family: ${raw}`);
  }
  return raw as VenvFamily;
}

async function handleNativeRun(req: Request, res: Response): Promise<void> {
  const parsed = parseBody<NativeRunBody>(req.body, nativeRunBodySpec);
  if (isParseBodyError(parsed)) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const body = parsed.parsed;
  let inputs: Record<string, { dtype: string; dims: number[]; data: number[] }>;
  try {
    inputs = coerceInputs(body.inputs);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Invalid inputs" });
    return;
  }

  const resolved = await resolveNativeModel({
    id: body.model_id,
    family: getVenvFamily(body.venv_family),
  });
  if (!resolved.ok) {
    res.status(resolved.status).json({
      error: resolved.status === 403 ? "Model not authorized" : "Model not found",
    });
    return;
  }

  const request = buildNativeRequest(resolved.absolutePath, inputs, {
    executionProvider: body.execution_provider,
    warmupIterations: body.warmup_iterations,
    iterations: body.iterations,
    batchSize: body.batch_size,
    includeOutputs: body.include_outputs,
  });

  try {
    const result: NativeResponse = await runNativeSidecar(
      request,
      getVenvFamily(body.venv_family),
    );
    res.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
}
