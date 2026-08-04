import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";

vi.mock("../services/venv/index.ts", () => ({
  ensureProviderCapability: vi.fn(async () => {
    throw new Error("ensureProviderCapability must not run for unknown providers");
  }),
  buildOliveRunEnvironment: vi.fn(async () => ({}) as NodeJS.ProcessEnv),
  resolveOliveCommand: vi.fn(() => ({
    executable: "python",
    args: ["-m", "olive"],
    family: "default",
  })),
  detachVenvListener: vi.fn(),
  getVenvPython: vi.fn(() => "/tmp/mock-python"),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      throw new Error("spawn should not run for unknown-provider rejection");
    }),
  };
});

vi.mock("../../lib/oliveRecipeSchema.ts", () => ({
  validateOliveRecipeStructure: () => ({ valid: true, errors: [] }),
}));

const { mountOliveRoutes } = await import("./olive.ts");
const { jobRegistry } = await import("../services/olive/state.ts");
const venv = await import("../services/venv/index.ts");

let server: Server;
let baseUrl: string;

function recipeWithProvider(provider: string) {
  return {
    input_model: { type: "HfModel", config: { model_path: "gpt2" } },
    systems: {
      local_system: {
        type: "LocalSystem",
        config: { accelerators: [{ device: "gpu", execution_providers: [provider] }] },
      },
    },
    passes: { c: { type: "OnnxConversion", config: {} } },
    engine: { search_strategy: false, evaluate_input_model: false },
  };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountOliveRoutes(router);
  app.use("/api", router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  jobRegistry.clear();
  vi.mocked(venv.ensureProviderCapability).mockClear();
});

describe("POST /olive/run provider routing", () => {
  it("returns 400 for unknown execution providers without ensuring a family", async () => {
    const res = await fetch(`${baseUrl}/api/olive/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipeJson: JSON.stringify(recipeWithProvider("NotARealExecutionProvider")),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Unknown execution provider/i);
    expect(venv.ensureProviderCapability).not.toHaveBeenCalled();
  });
});
