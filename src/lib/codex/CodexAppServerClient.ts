/**
 * Minimal JSON-RPC client for `codex app-server` over stdio (NDJSON).
 *
 * Auth + account/rate-limits live here. Recipe Q&A turns use `@openai/codex-sdk`,
 * which reuses the same local Codex auth store after ChatGPT login.
 *
 * Olive Studio launches `codex app-server --stdio` as a child process; having the
 * Codex CLI on PATH is enough (you do not need a separate daemon running).
 *
 * @see https://developers.openai.com/codex/app-server
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string | null; planType: string }
  | { type: "amazonBedrock"; credentialSource: string }
  | null;

export type CodexLoginStart = {
  type: "chatgpt";
  loginId: string;
  authUrl: string;
};

export type CodexRateLimits = {
  rateLimits: unknown;
  rateLimitsByLimitId: Record<string, unknown> | null;
  rateLimitResetCredits: unknown;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  id: number;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
  params?: unknown;
};

/**
 * Determines whether Codex should be spawned through a shell on the specified platform.
 *
 * @param command - The Codex command or executable path.
 * @param platform - The platform used to determine shell requirements.
 * @returns `true` on Windows for commands that do not end with `.exe`, `false` otherwise.
 */
export function codexSpawnUsesShell(command: string, platform = process.platform): boolean {
  if (platform !== "win32") return false;
  if (/\.exe$/i.test(command.trim())) return false;
  return true;
}

export class CodexAppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private started = false;
  private initialized = false;
  private starting: Promise<void> | null = null;

  /** Path to the `codex` binary; default resolves via PATH. */
  constructor(private readonly codexPath = "codex") {
    super();
    // EventEmitter throws if emit("error") has no listener; keep propagation optional.
    this.on("error", () => {});
  }

  get isReady(): boolean {
    return this.started && this.initialized && this.child != null && !this.child.killed;
  }

  async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.isReady) return;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (this.child) {
      await this.stop();
    }

    let child: ChildProcessWithoutNullStreams;
    const useShell = codexSpawnUsesShell(this.codexPath);
    const spawnOpts: SpawnOptionsWithoutStdio & { windowsHide?: boolean; shell?: boolean } = {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env },
      ...(useShell ? { shell: true } : {}),
    };
    try {
      child = spawn(this.codexPath, ["app-server", "--stdio"], spawnOpts) as ChildProcessWithoutNullStreams;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to start Codex app-server (${msg}). Install the Codex CLI (npm i -g @openai/codex) and ensure it is on PATH.`,
      );
    }

    this.child = child;
    this.started = true;

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => this.onLine(line));

    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString().trim();
      if (text) this.emit("stderr", text);
    });

    // Avoid unhandled 'error' on stdin when the child exits mid-write (EPIPE).
    child.stdin.on("error", (err) => {
      this.emit("error", err);
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    child.on("exit", (code, signal) => {
      this.started = false;
      this.initialized = false;
      this.child = null;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`Codex app-server exited (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      this.emit("exit", { code, signal });
    });

    child.on("error", (err) => {
      this.started = false;
      this.initialized = false;
      this.emit("error", err);
      const msg = err instanceof Error ? err.message : String(err);
      // Surface spawn failures (common on Windows without shell) to pending start().
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`Codex app-server spawn failed: ${msg}`));
      }
      this.pending.clear();
    });

    // If the process fails immediately (ENOENT), wait briefly then fail clearly.
    await new Promise<void>((resolve, reject) => {
      const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null) => {
        reject(
          new Error(
            `Codex app-server exited immediately (code=${code}, signal=${signal}). Is \`codex\` on PATH?`,
          ),
        );
      };
      const onEarlyError = (err: Error) => {
        reject(
          new Error(
            `Failed to start Codex app-server (${err.message}). Install the Codex CLI and ensure it is on PATH.`,
          ),
        );
      };
      child.once("exit", onEarlyExit);
      child.once("error", onEarlyError);
      setTimeout(() => {
        child.off("exit", onEarlyExit);
        child.off("error", onEarlyError);
        resolve();
      }, 150);
    });

    await this.initialize();
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.started = false;
    this.initialized = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Codex app-server stopped"));
    }
    this.pending.clear();
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    child.kill();
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      this.emit("parseError", trimmed);
      return;
    }

    // Notification (no id, has method)
    if (msg.method && (msg.id === undefined || msg.id === null)) {
      this.emit("notification", msg.method, msg.params);
      this.emit(msg.method, msg.params);
      return;
    }

    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    if (!Number.isFinite(id)) return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new Error(msg.error.message || `JSON-RPC error ${msg.error.code ?? "?"}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private writeLine(payload: object): Promise<void> {
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }
    return new Promise((resolve, reject) => {
      try {
        child.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          resolve();
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private notify(method: string, params?: unknown): Promise<void> {
    const payload: JsonRpcNotification =
      params !== undefined ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", method };
    return this.writeLine(payload).catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("error", error);
      throw error;
    });
  }

  private async request<T = unknown>(method: string, params?: unknown, timeoutMs = 60_000): Promise<T> {
    if (!this.child?.stdin.writable) {
      await this.start();
    }
    const child = this.child;
    if (!child?.stdin.writable) {
      throw new Error("Codex app-server is not running");
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      id,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      void this.writeLine(payload).catch((err) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: {
        name: "olive-studio",
        title: "Olive Studio",
        version: "0.2.0",
      },
      capabilities: null,
    });
    // Protocol expects an initialized notification after a successful initialize.
    await this.notify("initialized");
    this.initialized = true;
  }

  async readAccount(): Promise<{ account: CodexAccount; requiresOpenaiAuth: boolean }> {
    await this.start();
    return this.request("account/read", {});
  }

  async startChatGptLogin(): Promise<CodexLoginStart> {
    await this.start();
    const result = await this.request<
      { type: "chatgpt"; loginId: string; authUrl: string } | { type: string }
    >("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt",
    });
    if (result.type !== "chatgpt" || !("authUrl" in result) || !("loginId" in result)) {
      throw new Error(`Unexpected login response type: ${(result as { type: string }).type}`);
    }
    return result as CodexLoginStart;
  }

  async cancelLogin(loginId: string): Promise<void> {
    await this.start();
    await this.request("account/login/cancel", { loginId });
  }

  async logout(): Promise<void> {
    await this.start();
    await this.request("account/logout");
  }

  async readRateLimits(): Promise<CodexRateLimits> {
    await this.start();
    return this.request("account/rateLimits/read");
  }

  async getAuthStatus(): Promise<unknown> {
    await this.start();
    return this.request("getAuthStatus", {});
  }

  /** Live model catalog from the signed-in Codex app-server (`model/list`). */
  async listModels(): Promise<Array<{ id: string; label: string; isDefault?: boolean }>> {
    await this.start();
    const out: Array<{ id: string; label: string; isDefault?: boolean }> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.request<{
        data?: Array<{
          id?: string;
          model?: string;
          displayName?: string;
          hidden?: boolean;
          isDefault?: boolean;
        }>;
        nextCursor?: string | null;
      }>("model/list", {
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
        limit: 100,
      });
      for (const m of result.data ?? []) {
        if (m.hidden) continue;
        const id = (m.id || m.model || "").trim();
        if (!id) continue;
        out.push({
          id,
          label: (m.displayName || id).trim(),
          ...(m.isDefault ? { isDefault: true } : {}),
        });
      }
      cursor = result.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return out;
  }
}

/** Process-wide singleton (lazy). */
let singleton: CodexAppServerClient | null = null;

/**
 * Gets the process-wide Codex app-server client, creating it when necessary.
 *
 * @returns The shared Codex app-server client
 */
export function getCodexAppServer(): CodexAppServerClient {
  if (!singleton) {
    singleton = new CodexAppServerClient(process.env.CODEX_PATH || "codex");
  }
  return singleton;
}

/** Test helper: reset the singleton between tests. */
export function resetCodexAppServerForTests(): void {
  singleton = null;
}
