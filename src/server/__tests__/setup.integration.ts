/**
 * Integration test setup — mocks all external dependencies so tests run
 * reliably in any environment (CI, dev machine without Python/LM Studio/Ollama).
 *
 * Mocked:
 *   - child_process.execFile (callback-style)  → instant empty output
 *   - child_process.spawn                       → fake ChildProcess, exits 0
 *   - services/ai/index.ts callAI               → instantly rejects
 *   - globalThis.fetch for LM Studio/Ollama     → mock local model responses
 *
 * `execSync` and `spawnSync` remain unmocked — callers that need them
 * (e.g. `findLmsCli` for `where lms`) run real commands that fail fast
 * on systems without those tools.
 */
import { EventEmitter } from "events";
import { vi } from "vitest";

// ─── child_process: mock execFile + spawn ─────────────────────────────────

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();

  function mockExecFile(...execArgs: unknown[]): ReturnType<typeof actual.execFile> {
    const lastArg = execArgs[execArgs.length - 1];
    if (typeof lastArg === "function") {
      lastArg(null, "", "");
      return undefined as unknown as ReturnType<typeof actual.execFile>;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (actual.execFile as any)(...execArgs);
  }

  function mockSpawn(): ReturnType<typeof actual.spawn> {
    const proc = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>;
    proc.stdout = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>["stdout"];
    proc.stderr = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>["stderr"];
    proc.stdin = new EventEmitter() as unknown as ReturnType<typeof actual.spawn>["stdin"];
    (proc as unknown as Record<string, unknown>).pid = 99999;
    (proc as unknown as Record<string, unknown>).unref = () => {};
    (proc as unknown as Record<string, unknown>).kill = () => true;
    // Emit success on next tick so handlers can attach listeners first
    setImmediate(() => proc.emit("close", 0));
    return proc;
  }

  return {
    ...actual,
    execFile: mockExecFile as unknown as typeof actual.execFile,
    spawn: mockSpawn as unknown as typeof actual.spawn,
  };
});

// ─── AI provider: mock callAI to reject instantly ─────────────────────────

vi.mock("../services/ai/index.ts", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    callAI: vi
      .fn()
      .mockRejectedValue(new Error("No AI provider configured. Add an API key in Assistant → Settings.")),
  };
});

// ─── Global fetch: mock LM Studio (:1234) and Ollama (:11434) ─────────────

let _realFetch: typeof globalThis.fetch | null = null;

function createMockedFetch(): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("127.0.0.1:1234")) return mockLmStudio(url, init);
    if (url.includes("127.0.0.1:11434")) return mockOllama(url, init);

    return _realFetch!(input, init);
  };
}

async function mockLmStudio(url: string, _init?: RequestInit): Promise<Response> {
  if (url.includes("/v1/models")) {
    return new Response(
      JSON.stringify({
        data: [
          { id: "llama-3.2-3b-instruct", size: 2_000_000_000 },
          { id: "mistral-7b-instruct-v0.3", size: 7_000_000_000 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response("{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function mockOllama(url: string, _init?: RequestInit): Promise<Response> {
  if (url.includes("/api/tags")) {
    return new Response(
      JSON.stringify({
        models: [
          { name: "llama3:8b", size: 4_000_000_000 },
          { name: "codellama:7b", size: 3_800_000_000 },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.includes("/api/ps")) {
    return new Response(JSON.stringify({ models: [{ name: "llama3:8b" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("ok", { status: 200 });
}

/**
 * Call once in beforeAll() to activate mocked fetch.
 * Returns the real fetch so tests can call non-localhost URLs.
 */
export function stubGlobalFetch(): typeof globalThis.fetch {
  _realFetch = globalThis.fetch.bind(globalThis);
  vi.stubGlobal("fetch", createMockedFetch());
  return _realFetch as typeof globalThis.fetch;
}

/** Call once in afterAll() to restore real fetch. */
export function restoreGlobalFetch(): void {
  vi.unstubAllGlobals();
}
