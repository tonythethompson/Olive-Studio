/**
 * Helpers for LM Studio `lms get` stream output: progress parsing and failure hints.
 */

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Strip VT/ANSI escape sequences and normalize carriage returns for CLI TUI output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "").replace(/\r/g, "\n");
}

/** Split mixed `\r`/`\n` CLI chunks into non-empty log lines. */
export function splitCliLines(chunk: string): string[] {
  return stripAnsi(chunk)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Extract download percent (0–100) from an `lms get` progress line when present.
 * Examples: `6.60% | 108.60 MB / 1.65 GB` or `[████] 42%`.
 */
export function parseLmsGetPercent(line: string): number | null {
  const clean = stripAnsi(line).trim();
  if (!clean) return null;
  // Prefer patterns near a progress bar / size report to avoid matching unrelated numbers.
  const bar = clean.match(/\]\s*(\d+(?:\.\d+)?)\s*%/);
  if (bar) {
    const n = Number(bar[1]);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  }
  const sized = clean.match(/(\d+(?:\.\d+)?)\s*%\s*\|/);
  if (sized) {
    const n = Number(sized[1]);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  }
  return null;
}

/** Map raw CLI download % onto the NDJSON progress band used after engine ensure (5–95). */
export function mapLmsDownloadPercent(cliPercent: number): number {
  return Math.round(5 + (Math.max(0, Math.min(100, cliPercent)) / 100) * 90);
}

export type LmsPullFailureHint = { error: string; hint: string };

/**
 * Turn accumulated `lms get` logs + exit code into a clearer user-facing error.
 */
export function hintForLmsPullFailure(combinedLogs: string, code: number | null): LmsPullFailureHint {
  const t = stripAnsi(combinedLogs).toLowerCase();
  const exit = code === null ? "unknown" : String(code);

  if (t.includes("no staff picks found")) {
    return {
      error: "LM Studio could not resolve that model name.",
      hint: "Use a Hugging Face URL (https://huggingface.co/…) or open LM Studio and download from Discover.",
    };
  }
  if (
    t.includes("invalid username or password") ||
    t.includes("unauthorized") ||
    /\bhttps?\s*401\b|\b401\s+(unauthorized|auth)|(?:^|[\s({\[:])401(?:[\s)}\]:;,]|$)/i.test(
      stripAnsi(combinedLogs),
    )
  ) {
    return {
      error: "Hugging Face / LM Studio proxy rejected the download (auth).",
      hint: "Open LM Studio once, sign in if prompted, or pick a public community GGUF URL.",
    };
  }
  if (t.includes("failed to resolve download sources") || t.includes("artifact does not exist")) {
    return {
      error: "Could not resolve download sources for this model.",
      hint: "Check the model URL or try another quant / publisher in LM Studio.",
    };
  }
  if (t.includes("already in progress")) {
    return {
      error: "A download for this model is already in progress.",
      hint: "Wait for LM Studio to finish, or cancel the other download there, then retry.",
    };
  }
  if (t.includes("timed-out") || t.includes("timed out") || t.includes("timeout")) {
    return {
      error: "LM Studio download timed out.",
      hint: "Retry when the network is stable. Partial downloads can be resumed in LM Studio.",
    };
  }
  if (t.includes("enospc") || t.includes("no space") || t.includes("disk full") || t.includes("not enough space")) {
    return {
      error: "Not enough disk space for this model.",
      hint: "Free space under the LM Studio models folder, then retry.",
    };
  }
  if (t.includes("model already downloaded")) {
    return {
      error: `LM Studio exited with code ${exit} after reporting the model was already downloaded.`,
      hint: "Refresh Installed models and use Enable, or run `lms load <model>` in a terminal.",
    };
  }

  return {
    error: `LM Studio download exited with code ${exit}`,
    hint: "Official CLI is `lms get <model> -y` (not `pull`). Open LM Studio once if get fails to resolve the model.",
  };
}
