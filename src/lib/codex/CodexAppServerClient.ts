/**
 * Minimal JSON-RPC client for `codex app-server` over stdio (NDJSON).
 *
 * Auth + account/rate-limits live here. Recipe Q&A turns use `@openai/codex-sdk`,
 * which reuses the same local Codex auth store after ChatGPT login.
 *
 * @see https://developers.openai.com/codex/app-server
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
  jsonrpc?: "2.0";
  method: string;
  id: number;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc?: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
  method?: string;
  params?: unknown;
};

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
    try {
      child = spawn(this.codexPath, ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env },
      });
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
      this.emit("error", err);
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
      child.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
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
}

/** Process-wide singleton (lazy). */
let singleton: CodexAppServerClient | null = null;

export function getCodexAppServer(): CodexAppServerClient {
  if (!singleton) {
    singleton = new CodexAppServerClient(process.env.CODEX_PATH || "codex");
  }
  return singleton;
}
