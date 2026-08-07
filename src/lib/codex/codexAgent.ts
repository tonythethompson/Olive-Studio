/**
 * Recipe Q&A / review via @openai/codex-sdk.
 * Uses local Codex auth (ChatGPT subscription or API key after `codex login`).
 * Sandbox is read-only; approval policy never — no shell/file mutation without UI.
 */

export type CodexAskOptions = {
  /** Absolute project root for workspace context */
  workingDirectory?: string;
  model?: string;
  signal?: AbortSignal;
};

type CodexThread = {
  run: (
    prompt: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{
    finalResponse?: string;
    items: Array<{ type?: string; text?: string }>;
  }>;
};

type CodexClient = {
  startThread: (options: {
    model?: string;
    workingDirectory?: string;
    sandboxMode?: string;
    approvalPolicy?: string;
    skipGitRepoCheck?: boolean;
    networkAccessEnabled?: boolean;
    webSearchMode?: string;
  }) => CodexThread;
};

type CodexSdkModule = {
  Codex: new (options: { codexPathOverride?: string }) => CodexClient;
};

let codexSingleton: CodexClient | null = null;
let codexModulePromise: Promise<CodexSdkModule> | null = null;

function loadCodexSdk(): Promise<CodexSdkModule> {
  // Avoid static analysis so the CJS server bundle does not require() this ESM-only package at startup.
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<CodexSdkModule>;
  return dynamicImport("@openai/codex-sdk");
}

/** True only for Node's "can't resolve @openai/codex-sdk" errors, not transitive module or evaluation/export failures. */
export function isModuleNotFoundError(err: unknown): boolean {
  if (
    !(
      err instanceof Error &&
      "code" in err &&
      (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "MODULE_NOT_FOUND")
    )
  ) {
    return false;
  }
  const specifier =
    ("specifier" in err && typeof err.specifier === "string" && err.specifier
      ? err.specifier
      : "url" in err && typeof err.url === "string" && err.url
        ? err.url
        : err.message.match(/Cannot find (?:package|module) ['"]([^'\"]+)['\"]/)?.[1]) ??
    "";

  return specifier === "@openai/codex-sdk";
}

export function _resetCodexStateForTests(): void {
  codexSingleton = null;
  codexModulePromise = null;
}

export async function getCodex(): Promise<CodexClient> {
  if (!codexSingleton) {
    codexModulePromise ??= loadCodexSdk();
    let Codex: CodexSdkModule["Codex"];
    try {
      const mod = await codexModulePromise;
      Codex = mod?.Codex;
      if (typeof Codex !== "function") {
        throw new Error("Module '@openai/codex-sdk' does not export a valid Codex constructor.");
      }
    } catch (err) {
      // Reset so a later install (or a transient failure) doesn't require a server restart.
      codexModulePromise = null;
      if (isModuleNotFoundError(err)) {
        throw new Error(
          "Codex provider unavailable: @openai/codex-sdk (optionalDependencies) is not installed. Run `pnpm add --save-optional @openai/codex-sdk` to enable it.",
          { cause: err },
        );
      }
      // Module resolved but failed to evaluate/export correctly — a missing-package
      // message here would be misleading.
      throw new Error("Codex provider failed to load.", { cause: err });
    }
    codexSingleton = new Codex({
      codexPathOverride: process.env.CODEX_PATH || undefined,
    });
  }
  return codexSingleton;
}

/**
 * Run a single non-mutating Codex turn and return the final agent text.
 */
export async function codexAsk(prompt: string, options: CodexAskOptions = {}): Promise<string> {
  const codex = await getCodex();
  const thread = codex.startThread({
    model: options.model,
    workingDirectory: options.workingDirectory ?? process.cwd(),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    networkAccessEnabled: true,
    webSearchMode: "disabled",
  });

  const turn = await thread.run(prompt, { signal: options.signal });
  if (turn.finalResponse?.trim()) {
    return turn.finalResponse.trim();
  }
  // Fallback: last agent_message item
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const item = turn.items[i];
    if (item && item.type === "agent_message" && typeof item.text === "string") {
      return item.text.trim();
    }
  }
  throw new Error("Codex returned no agent message. Sign in with ChatGPT via Assistant → Codex.");
}

/**
 * Build an Olive-focused prompt from system + chat messages for Codex turns.
 */
export function buildCodexPrompt(system: string, messages: Array<{ role: string; content: string }>): string {
  const history = messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n\n");
  return [
    "You are assisting with Microsoft Olive model optimization in Olive Studio.",
    "Do not run shell commands or modify files. Answer from the provided context only.",
    "",
    "### System instructions",
    system,
    "",
    "### Conversation",
    history || "(no prior messages)",
    "",
    "Respond helpfully and specifically about Olive recipes, execution providers, quantization, and local runs.",
  ].join("\n");
}
