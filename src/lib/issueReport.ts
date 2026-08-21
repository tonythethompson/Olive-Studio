import type { HardwareProbeResult } from "./hardwareProbe";
import type { UIState } from "@/types";

// ── Report categories ────────────────────────────────────────────────────────

export const REPORT_CATEGORIES = [
  { id: "bug", label: "Bug report", hasSeverity: true },
  { id: "feature", label: "Feature request", hasSeverity: false },
  { id: "docs", label: "Documentation", hasSeverity: false },
  { id: "other", label: "Other", hasSeverity: false },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

export const REPORT_SEVERITIES = [
  { id: "n-a", label: "N/A" },
  { id: "annoying", label: "Annoying" },
  { id: "blocking", label: "Blocking" },
  { id: "crash", label: "Crash" },
  { id: "silent", label: "Silent data loss" },
] as const;

/** Severity only describes bug impact; other categories have nothing to rate. */
export function categoryHasSeverity(category: ReportCategory): boolean {
  return REPORT_CATEGORIES.find((candidate) => candidate.id === category)?.hasSeverity ?? false;
}

export type ReportSeverity = (typeof REPORT_SEVERITIES)[number]["id"];

export const REPORT_AREAS = [
  { id: "recipe-builder", label: "Model source" },
  { id: "hardware-ep", label: "Hardware" },
  { id: "execution-batch", label: "Recipe & run" },
  { id: "playground-arena", label: "Playground" },
  { id: "assistant-ai", label: "Assistant" },
  { id: "install-venv", label: "Install / venv" },
  { id: "other", label: "Other" },
] as const;

export type ReportArea = (typeof REPORT_AREAS)[number]["id"];

const PIPELINE_VIEW_TO_REPORT_AREA = {
  input: "recipe-builder",
  ihv: "hardware-ep",
  execute: "execution-batch",
  playground: "playground-arena",
} as const satisfies Record<string, ReportArea>;

/**
 * Maps the active left-rail pipeline stage to a report Area.
 * Assistant is intentionally omitted; that sidebar has its own report button.
 */
export function pipelineViewToReportArea(view: string | undefined | null): ReportArea {
  if (!view) return "other";
  return PIPELINE_VIEW_TO_REPORT_AREA[view as keyof typeof PIPELINE_VIEW_TO_REPORT_AREA] ?? "other";
}

// ── Telemetry options ────────────────────────────────────────────────────────

export const TELEMETRY_OPTIONS = [
  { id: "platform", label: "Platform & OS", description: "Windows/macOS/Linux, architecture" },
  { id: "hardware", label: "GPU & hardware", description: "GPU model, VRAM, CPU, RAM" },
  { id: "olive-version", label: "Olive & ORT versions", description: "ONNX Runtime and Olive engine versions" },
  { id: "recipe", label: "Current recipe", description: "The active recipe JSON (redacted)" },
  { id: "logs", label: "Execution logs", description: "Recent log lines from the last run" },
  { id: "chat-logs", label: "Assistant chat log", description: "Recent messages from this chat session (redacted)" },
] as const;

export type TelemetryOptionId = (typeof TELEMETRY_OPTIONS)[number]["id"];

// ── Redaction ────────────────────────────────────────────────────────────────

/** Patterns that look like secrets, tokens, or API keys. */
const SECRET_PATTERNS: RegExp[] = [
  // API keys / tokens (generic)
  /(?:api[_-]?key|token|secret|password|credential|auth)["'\s:=]+\S{8,}/gi,
  // Hugging Face tokens
  /hf_[A-Za-z0-9]{10,}/g,
  // GitHub tokens
  /gh[ps]_[A-Za-z0-9]{36,}/g,
  // AWS-style keys
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  // Bearer tokens (Authorization header)
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  // JSON Web Tokens — canonical form (JWS: 3 segments, JWE: 5 segments, base64url header starting with eyJ).
  // The `{2,}` requires at least 3 segments and greedily consumes every
  // contiguous dot-separated base64url segment so a complete 5-segment JWE is
  // redacted in one match (the trailing lookahead must not stop at a `.`).
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2,}(?![A-Za-z0-9_-])/g,
  // Dotted base64url tokens that don't start with eyJ but are long enough to be secrets
  // (3+ segments, each ≥8 chars — safely excludes semver, model names, and short identifiers)
  /(?<![A-Za-z0-9_\-/])(?!eyJ)[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})*(?![A-Za-z0-9_\-/])/g,
  // PEM private-key blocks
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
  // Generic long hex strings that look like secrets (32+ hex chars)
  /(?:["'\s:=]|^)[0-9a-f]{32,}(?:["'\s]|$)/gi,
  // Paths containing user home directories (privacy)
  /\/home\/[^/]+/g,
  /C:\\Users\\[^\\]+/g,
  /\/Users\/[^/]+/g,
  /~\/\S+/g,
  /(?:"api_key"|"secret"|"token"|"password"|"credential")["\s:]+["'][^"']{8,}["']/gi,
];

/**
 * Redacts sensitive information from text.
 * Replaces matches with `[REDACTED]` while preserving surrounding context.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Preserve the first and last character if they are delimiters
      const first = match[0];
      const last = match[match.length - 1];
      const needsPad =
        (first === '"' || first === "'" || first === " ") &&
        (last === '"' || last === "'" || last === " ");
      if (needsPad) {
        return `${first}[REDACTED]${last}`;
      }
      return "[REDACTED]";
    });
  }
  return result;
}

// ── Report data structure ────────────────────────────────────────────────────

export interface IssueReport {
  category: ReportCategory;
  severity: ReportSeverity;
  area: ReportArea;
  title?: string;
  description: string;
  screenshotName?: string | null;
  telemetry: Partial<Record<TelemetryOptionId, string>>;
  /** Error frequency info for repeated crashes */
  frequencyInfo?: {
    count: number;
    firstOccurrenceAgo: number;
    lastOccurrenceAgo: number;
    frequencyLabel: string;
  } | null;
}

export interface BuildReportOptions {
  state?: UIState;
  hardwareProbe?: HardwareProbeResult | null;
  executionLogs?: string[];
  /** Recent assistant chat transcript, formatted as one "sender: text" line per turn. */
  chatLog?: string[];
  mcpDiagnostic?: unknown;
}

// ── Telemetry collection ─────────────────────────────────────────────────────

function collectPlatformInfo(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (!ua) return "OS: Unknown | Arch: Unknown";
  let os = "Unknown";
  let arch = "Unknown";

  if (ua.includes("Win")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";

  if (ua.includes("x86_64") || ua.includes("x64") || ua.includes("Win64")) arch = "x64";
  else if (ua.includes("arm64") || ua.includes("aarch64")) arch = "arm64";

  return `OS: ${os} | Arch: ${arch}`;
}

function collectHardwareInfo(probe: HardwareProbeResult | null | undefined): string {
  if (!probe) return "Hardware probe not available";

  const parts: string[] = [];
  const p = probe.platform;
  parts.push(`CPU: ${p.cpuModel} (${p.cpuCores} cores)`);
  if (p.systemRamGb) parts.push(`RAM: ${p.systemRamGb} GB`);

  if (probe.nvidia?.gpus?.length) {
    const gpu = probe.nvidia.gpus[0]!;
    parts.push(`GPU: ${gpu.name}`);
    if (gpu.vramMb) parts.push(`VRAM: ${Math.round(gpu.vramMb / 1024)} GB`);
    if (probe.nvidia.cudaVersion) parts.push(`CUDA: ${probe.nvidia.cudaVersion}`);
  } else if (probe.rocm?.gpus?.length) {
    const gpu = probe.rocm.gpus[0]!;
    parts.push(`GPU: ${gpu.name} (ROCm)`);
  }

  return parts.join(" | ");
}

function collectOliveVersion(): string {
  return "ORT pinned: 1.26.0 | Olive: 0.13.0";
}

function collectRecipeInfo(state: UIState | undefined): string {
  if (!state) return "No pipeline state";
  const parts: string[] = [];
  parts.push(`Model: ${state.hfModelId || state.modelSource}`);
  parts.push(`EP: ${state.ihvProvider}`);
  const activePasses: string[] = [];
  if (state.passes.conversion) activePasses.push("Conversion");
  if (state.passes.quantization) activePasses.push("Quantization");
  if (state.passes.pruning) activePasses.push("Pruning");
  if (state.passes.onnxTransforms) activePasses.push("ORT Transforms");
  parts.push(`Passes: ${activePasses.length > 0 ? activePasses.join(", ") : "None"}`);
  return parts.join(" | ");
}

function collectLogs(logs: string[] | undefined, maxLines = 50): string {
  if (!logs || logs.length === 0) return "No logs available";
  // Take the last N lines to keep the report concise
  const recent = logs.slice(-maxLines);
  return recent.join("\n");
}

function collectChatLog(chatLog: string[] | undefined, maxLines = 20): string {
  if (!chatLog || chatLog.length === 0) return "No chat history available";
  // Filter out any leading assistant greetings/boilerplate before the first user turn
  const firstUserIdx = chatLog.findIndex((line) => line.trim().toLowerCase().startsWith("user:"));
  const filtered =
    firstUserIdx >= 0
      ? chatLog.slice(firstUserIdx)
      : chatLog.filter(
        (line) =>
          !line.toLowerCase().includes("olive studio assistant") &&
          !line.toLowerCase().startsWith("assistant: hello"),
      );
  if (filtered.length === 0) return "No chat history available";
  return filtered.slice(-maxLines).join("\n");
}

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Collects telemetry data based on selected options.
 */
export function collectTelemetry(
  options: TelemetryOptionId[],
  buildOptions: BuildReportOptions,
): Partial<Record<TelemetryOptionId, string>> {
  const telemetry: Partial<Record<TelemetryOptionId, string>> = {};

  for (const opt of options) {
    switch (opt) {
      case "platform":
        telemetry.platform = redactSecrets(collectPlatformInfo());
        break;
      case "hardware":
        telemetry.hardware = redactSecrets(collectHardwareInfo(buildOptions.hardwareProbe));
        break;
      case "olive-version":
        telemetry["olive-version"] = collectOliveVersion();
        break;
      case "recipe":
        telemetry.recipe = redactSecrets(collectRecipeInfo(buildOptions.state));
        break;
      case "logs":
        telemetry.logs = redactSecrets(collectLogs(buildOptions.executionLogs));
        break;
      case "chat-logs":
        telemetry["chat-logs"] = redactSecrets(collectChatLog(buildOptions.chatLog)).replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
        break;
    }
  }

  return telemetry;
}

export interface BuildIssueBodyOptions {
  chatLogOffloaded?: boolean;
  logsOffloaded?: boolean;
  hasScreenshot?: boolean;
  screenshotName?: string | null;
}

/**
 * Builds the GitHub issue body from a report.
 */
export function buildIssueBody(report: IssueReport, options?: BuildIssueBodyOptions): string {
  const lines: string[] = [];
  const hasSeverity = categoryHasSeverity(report.category);
  const severity = hasSeverity ? (report.severity === "n-a" ? "annoying" : report.severity) : "n-a";

  // Header
  lines.push("## Issue Report");
  lines.push("");

  // Metadata
  lines.push(`**Category:** ${REPORT_CATEGORIES.find((c) => c.id === report.category)?.label ?? report.category}`);
  lines.push(`**Severity:** ${REPORT_SEVERITIES.find((s) => s.id === severity)?.label ?? severity}`);
  lines.push(`**Area:** ${REPORT_AREAS.find((a) => a.id === report.area)?.label ?? report.area}`);

  // Frequency info for repeated errors
  if (report.frequencyInfo && report.frequencyInfo.count > 1) {
    lines.push(`**Occurrences:** ${report.frequencyInfo.count} times`);
    const minutes = Math.floor(report.frequencyInfo.firstOccurrenceAgo / 60);
    const seconds = report.frequencyInfo.firstOccurrenceAgo % 60;
    if (minutes > 0) {
      lines.push(`**First seen:** ${minutes}m ${seconds}s ago`);
    } else {
      lines.push(`**First seen:** ${seconds}s ago`);
    }
  }
  lines.push("");

  // Description (redacted for security)
  lines.push("### Description");
  lines.push("");
  lines.push(redactSecrets(report.description) || "_(no description provided)_");
  lines.push("");

  // Screenshot section
  const screenshot = options?.screenshotName ?? report.screenshotName;
  if (options?.hasScreenshot || screenshot) {
    lines.push("### Screenshots");
    lines.push("");
    if (screenshot) {
      lines.push(`_A screenshot named \`${screenshot}\` was selected. Prefilled issue links cannot include images, so paste (Ctrl+V) or drag and drop it here after the form opens._`);
    } else {
      lines.push("_Attach screenshots here by pasting (Ctrl+V) or dragging and dropping._");
    }
    lines.push("");
  }

  // Telemetry
  const telemetryKeys = Object.keys(report.telemetry) as TelemetryOptionId[];
  if (telemetryKeys.length > 0) {
    lines.push("### Telemetry");
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Click to expand telemetry data</summary>");
    lines.push("");
    lines.push("```");
    for (const key of telemetryKeys) {
      const label = TELEMETRY_OPTIONS.find((o) => o.id === key)?.label ?? key;
      lines.push(`[${label}]`);
      if (key === "chat-logs" && options?.chatLogOffloaded) {
        lines.push("(Chat log copied to clipboard — paste into issue where indicated)");
      } else if (key === "logs" && options?.logsOffloaded) {
        lines.push("(Execution logs copied to clipboard — paste into issue where indicated)");
      } else {
        lines.push(report.telemetry[key] ?? "N/A");
      }
      lines.push("");
    }
    lines.push("```");
    lines.push("</details>");
    lines.push("");
  }

  // If execution logs was offloaded, add a clear paste anchor in the issue body
  if (options?.logsOffloaded && report.telemetry["logs"]) {
    lines.push("### Execution Logs");
    lines.push("");
    lines.push("> _Execution logs were copied to your clipboard (exceeded URL length limits). Paste (Ctrl+V) here:_");
    lines.push("");
    lines.push("```");
    lines.push("<!-- Paste execution logs from clipboard here -->");
    lines.push("```");
    lines.push("");
  }

  // If chat log was offloaded, add a clear paste anchor in the issue body
  if (options?.chatLogOffloaded && report.telemetry["chat-logs"]) {
    lines.push("### Assistant Chat Log");
    lines.push("");
    lines.push("> _Chat log was copied to your clipboard (exceeded URL length limits). Paste (Ctrl+V) here:_");
    lines.push("");
    lines.push("```");
    lines.push("<!-- Paste assistant chat log from clipboard here -->");
    lines.push("```");
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push("_Reported from Olive Studio_");

  return lines.join("\n");
}

/**
 * Builds the GitHub issue title from a report.
 */
export function buildIssueTitle(report: IssueReport): string {
  const categoryLabel = REPORT_CATEGORIES.find((c) => c.id === report.category)?.label ?? report.category;
  const areaLabel = REPORT_AREAS.find((a) => a.id === report.area)?.label ?? report.area;
  const customTitle = report.title?.trim();
  const summary = customTitle
    ? redactSecrets(customTitle).replace(/\n/g, " ").trim().slice(0, 60)
    : redactSecrets(report.description).slice(0, 60).replace(/\n/g, " ").trim();
  return `[${categoryLabel}] ${areaLabel}: ${summary || "Untitled report"}`;
}

const REPO_URL = "https://github.com/tonythethompson/Olive-Studio";
const ISSUE_NEW_URL = `${REPO_URL}/issues/new`;
/** Encoded URL budget for prefilled GitHub issue links (browsers and intermediaries truncate long URLs). */
const MAX_GITHUB_ISSUE_URL_LENGTH = 2000;

export interface GitHubIssueUrlDetails {
  url: string;
  body: string;
  fullBody: string;
  title: string;
  exceededBudget: boolean;
  chatLogOffloaded: boolean;
  logsOffloaded: boolean;
  offloadedClipboardText: string | null;
}

/**
 * Generates pre-filled GitHub issue URL details with smart progressive offloading.
 */
export function buildGitHubIssueUrlDetails(report: IssueReport): GitHubIssueUrlDetails {
  const title = buildIssueTitle(report);
  const fullBody = buildIssueBody(report, { hasScreenshot: Boolean(report.screenshotName) });

  const makeUrl = (bodyContent: string) => {
    const params = new URLSearchParams();
    params.set("title", title);
    params.set("body", bodyContent);
    params.set("labels", ["user-report", report.category].join(","));
    return `${ISSUE_NEW_URL}?${params.toString()}`;
  };

  // Step 1: Try full issue body
  let url = makeUrl(fullBody);
  if (url.length <= MAX_GITHUB_ISSUE_URL_LENGTH) {
    return {
      url,
      body: fullBody,
      fullBody,
      title,
      exceededBudget: false,
      chatLogOffloaded: false,
      logsOffloaded: false,
      offloadedClipboardText: null,
    };
  }

  // Step 2: If chat-logs exists, offload chat-logs to clipboard
  if (report.telemetry["chat-logs"]) {
    const bodyWithOffloadedChat = buildIssueBody(report, {
      chatLogOffloaded: true,
      hasScreenshot: Boolean(report.screenshotName),
    });
    url = makeUrl(bodyWithOffloadedChat);
    if (url.length <= MAX_GITHUB_ISSUE_URL_LENGTH) {
      return {
        url,
        body: bodyWithOffloadedChat,
        fullBody,
        title,
        exceededBudget: false,
        chatLogOffloaded: true,
        logsOffloaded: false,
        offloadedClipboardText: report.telemetry["chat-logs"],
      };
    }
  }

  // Step 3: If logs exists (e.g. execution logs are large, even without chat logs), offload logs
  if (report.telemetry["logs"]) {
    const bodyWithOffloadedLogs = buildIssueBody(report, {
      chatLogOffloaded: Boolean(report.telemetry["chat-logs"]),
      logsOffloaded: true,
      hasScreenshot: Boolean(report.screenshotName),
    });
    url = makeUrl(bodyWithOffloadedLogs);
    if (url.length <= MAX_GITHUB_ISSUE_URL_LENGTH) {
      const parts: string[] = [];
      if (report.telemetry["logs"]) {
        parts.push(report.telemetry["logs"]);
      }
      if (report.telemetry["chat-logs"]) {
        parts.push(report.telemetry["chat-logs"]);
      }
      return {
        url,
        body: bodyWithOffloadedLogs,
        fullBody,
        title,
        exceededBudget: false,
        chatLogOffloaded: Boolean(report.telemetry["chat-logs"]),
        logsOffloaded: true,
        offloadedClipboardText: parts.join("\n\n"),
      };
    }
  }

  // Step 4: If still too long (e.g. user description is very large), truncate description in URL query
  if (report.description.length > 300) {
    const truncatedReport: IssueReport = {
      ...report,
      description: `${report.description.slice(0, 300)}\n\n> [!NOTE]\n> _Description truncated for URL length; full text was copied to clipboard._`,
    };
    const bodyTruncated = buildIssueBody(truncatedReport, {
      chatLogOffloaded: Boolean(report.telemetry["chat-logs"]),
      logsOffloaded: Boolean(report.telemetry["logs"]),
      hasScreenshot: Boolean(report.screenshotName),
    });
    url = makeUrl(bodyTruncated);
    if (url.length <= MAX_GITHUB_ISSUE_URL_LENGTH) {
      return {
        url,
        body: bodyTruncated,
        fullBody,
        title,
        exceededBudget: false,
        chatLogOffloaded: Boolean(report.telemetry["chat-logs"]),
        logsOffloaded: Boolean(report.telemetry["logs"]),
        offloadedClipboardText: `# ${title}\n\n${fullBody}`,
      };
    }
  }

  // Fallback to blank issue URL only if even title/minimal params fail
  console.warn(
    "[issueReport] Encoded GitHub issue URL exceeds budget; using blank issue form. Paste the full report from the clipboard.",
  );
  return {
    url: ISSUE_NEW_URL,
    body: fullBody,
    fullBody,
    title,
    exceededBudget: true,
    chatLogOffloaded: Boolean(report.telemetry["chat-logs"]),
    logsOffloaded: Boolean(report.telemetry["logs"]),
    offloadedClipboardText: `# ${title}\n\n${fullBody}`,
  };
}

/**
 * Generates a pre-filled GitHub issue URL.
 */
export function buildGitHubIssueUrl(report: IssueReport): string {
  return buildGitHubIssueUrlDetails(report).url;
}

export interface BuildReportResult {
  url: string;
  body: string;
  title: string;
  fullText: string;
  urlExceededBudget: boolean;
  chatLogOffloaded: boolean;
  logsOffloaded: boolean;
  offloadedClipboardText: string | null;
}

/**
 * Builds the full report and generates the GitHub issue URL.
 */
export function buildReport(report: IssueReport): BuildReportResult {
  const details = buildGitHubIssueUrlDetails(report);
  // Full text for clipboard (includes title as header)
  const fullText = `# ${details.title}\n\n${details.fullBody}`;

  return {
    url: details.url,
    body: details.body,
    title: details.title,
    fullText,
    urlExceededBudget: details.exceededBudget,
    chatLogOffloaded: details.chatLogOffloaded,
    logsOffloaded: details.logsOffloaded,
    offloadedClipboardText: details.offloadedClipboardText,
  };
}
