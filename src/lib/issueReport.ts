import type { HardwareProbeResult } from "./hardwareProbe";
import type { UIState } from "@/types";

// ── Report categories ────────────────────────────────────────────────────────

export const REPORT_CATEGORIES = [
  { id: "bug", label: "Bug report" },
  { id: "feature", label: "Feature request" },
  { id: "docs", label: "Documentation" },
  { id: "other", label: "Other" },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

export const REPORT_SEVERITIES = [
  { id: "annoying", label: "Annoying" },
  { id: "blocking", label: "Blocking" },
  { id: "crash", label: "Crash" },
  { id: "silent", label: "Silent data loss" },
] as const;

export type ReportSeverity = (typeof REPORT_SEVERITIES)[number]["id"];

export const REPORT_AREAS = [
  { id: "recipe-builder", label: "Recipe builder" },
  { id: "hardware-ep", label: "Hardware / EP" },
  { id: "execution-batch", label: "Execution & batch" },
  { id: "playground-arena", label: "Playground / Arena" },
  { id: "assistant-ai", label: "Assistant AI" },
  { id: "install-venv", label: "Install / venv" },
  { id: "other", label: "Other" },
] as const;

export type ReportArea = (typeof REPORT_AREAS)[number]["id"];

// ── Telemetry options ────────────────────────────────────────────────────────

export const TELEMETRY_OPTIONS = [
  { id: "platform", label: "Platform & OS", description: "Windows/macOS/Linux, architecture" },
  { id: "hardware", label: "GPU & hardware", description: "GPU model, VRAM, CPU, RAM" },
  { id: "olive-version", label: "Olive & ORT versions", description: "ONNX Runtime and Olive engine versions" },
  { id: "recipe", label: "Current recipe", description: "The active recipe JSON (redacted)" },
  { id: "logs", label: "Execution logs", description: "Recent log lines from the last run" },
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
  // Generic long hex strings that look like secrets (32+ hex chars)
  /(?:["'\s:=]|^)[0-9a-f]{32,}(?:["'\s]|$)/gi,
  // Paths containing user home directories (privacy)
  /\/home\/[^/]+/g,
  /C:\\Users\\[^\\]+/g,
  /\/Users\/[^/]+/g,
  /~\/[^\s]+/g,
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
  description: string;
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
  return "ORT pinned: 1.26.0 | Olive: 0.12.1";
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
    }
  }

  return telemetry;
}

/**
 * Builds the GitHub issue body from a report.
 */
export function buildIssueBody(report: IssueReport): string {
  const lines: string[] = [];

  // Header
  lines.push("## Issue Report");
  lines.push("");

  // Metadata
  lines.push(`**Category:** ${REPORT_CATEGORIES.find((c) => c.id === report.category)?.label ?? report.category}`);
  lines.push(`**Severity:** ${REPORT_SEVERITIES.find((s) => s.id === report.severity)?.label ?? report.severity}`);
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
      lines.push(report.telemetry[key] ?? "N/A");
      lines.push("");
    }
    lines.push("```");
    lines.push("</details>");
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
  const snippet = redactSecrets(report.description).slice(0, 60).replace(/\n/g, " ").trim();
  return `[${categoryLabel}] ${areaLabel}: ${snippet || "Untitled report"}`;
}

const REPO_URL = "https://github.com/tonythethompson/Olive-Studio";
const ISSUE_NEW_URL = `${REPO_URL}/issues/new`;
/** Encoded URL budget for prefilled GitHub issue links (browsers and intermediaries truncate long URLs). */
const MAX_GITHUB_ISSUE_URL_LENGTH = 2000;

/**
 * Generates a pre-filled GitHub issue URL.
 * When the encoded URL exceeds the budget, returns the canonical blank issue form instead.
 */
export function buildGitHubIssueUrl(report: IssueReport): string {
  return buildGitHubIssueUrlDetails(report).url;
}

function buildGitHubIssueUrlDetails(report: IssueReport): { url: string; exceededBudget: boolean } {
  const title = buildIssueTitle(report);
  const body = buildIssueBody(report);

  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  params.set("labels", ["user-report", report.category].join(","));

  const url = `${ISSUE_NEW_URL}?${params.toString()}`;

  if (url.length > MAX_GITHUB_ISSUE_URL_LENGTH) {
    console.warn(
      "[issueReport] Encoded GitHub issue URL exceeds budget; using blank issue form. Paste the full report from the clipboard.",
    );
    return { url: ISSUE_NEW_URL, exceededBudget: true };
  }

  return { url, exceededBudget: false };
}

/**
 * Builds the full report and generates the GitHub issue URL.
 */
export function buildReport(
  report: IssueReport,
  _buildOptions: BuildReportOptions,
): { url: string; body: string; title: string; fullText: string; urlExceededBudget: boolean } {
  const title = buildIssueTitle(report);
  const body = buildIssueBody(report);
  const { url, exceededBudget } = buildGitHubIssueUrlDetails(report);

  // Full text for clipboard (includes title as header)
  const fullText = `# ${title}\n\n${body}`;

  return { url, body, title, fullText, urlExceededBudget: exceededBudget };
}
