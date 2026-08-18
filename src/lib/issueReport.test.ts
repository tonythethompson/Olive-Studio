import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  collectTelemetry,
  buildIssueBody,
  buildIssueTitle,
  buildGitHubIssueUrl,
  buildReport,
  categoryHasSeverity,
  type IssueReport,
  type BuildReportOptions,
  pipelineViewToReportArea,
} from "./issueReport";

// ── Redaction ────────────────────────────────────────────────────────────────

describe("pipelineViewToReportArea", () => {
  it("maps each left-rail pipeline stage to a report area", () => {
    expect(pipelineViewToReportArea("input")).toBe("recipe-builder");
    expect(pipelineViewToReportArea("ihv")).toBe("hardware-ep");
    expect(pipelineViewToReportArea("execute")).toBe("execution-batch");
    expect(pipelineViewToReportArea("playground")).toBe("playground-arena");
  });

  it("does not treat assistant as a pipeline stage", () => {
    expect(pipelineViewToReportArea("assistant")).toBe("other");
    expect(pipelineViewToReportArea(undefined)).toBe("other");
  });
});

describe("redactSecrets", () => {
  it("redacts Hugging Face tokens", () => {
    expect(redactSecrets("token: hf_abc123def456ghi789")).toContain("[REDACTED]");
    expect(redactSecrets("token: hf_abc123def456ghi789")).not.toContain("hf_abc123");
  });

  it("redacts GitHub tokens", () => {
    expect(redactSecrets("ghp_1234567890abcdefghijklmnopqrstuvwxyz123456")).toContain("[REDACTED]");
  });

  it("redacts AWS-style keys", () => {
    expect(redactSecrets("AKIAIOSFODNN7EXAMPLE")).toContain("[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test")).toContain("[REDACTED]");
  });

  it("redacts API key patterns", () => {
    expect(redactSecrets('api_key="sk-1234567890abcdef1234567890"')).toContain("[REDACTED]");
  });

  it("redacts standalone JWTs and PEM private keys while preserving model names and semantic versions", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue123";
    const pem = "-----BEGIN PRIVATE KEY-----\nsecret-material\n-----END PRIVATE KEY-----";
    const redacted = redactSecrets(`jwt=${jwt}\nkey=${pem}`);
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toContain("secret-material");
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBe(2);

    const modelName = "Qwen/Qwen2.5-0.5B-Instruct";
    const semver = "v1.2.3";
    expect(redactSecrets(`Model: ${modelName}, Version: ${semver}`)).toBe(`Model: ${modelName}, Version: ${semver}`);
  });

  it("redacts compact JWTs with short segments", () => {
    const compact = "eyJhbGciOiJ9.e30.x";
    const redacted = redactSecrets(`token=${compact}`);
    expect(redacted).not.toContain(compact);
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts complete five-segment compact JWEs in one match", () => {
    const jwe =
      "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0.encryptedKey123456.ivSegment123456.ciphertext123456.authTag123456";
    const redacted = redactSecrets(`token=${jwe}`);
    expect(redacted).not.toContain(jwe);
    // The full five segments must be consumed — no trailing segment may survive.
    expect(redacted).not.toContain("encryptedKey123456");
    expect(redacted).not.toContain("ciphertext123456");
    expect(redacted).not.toContain("authTag123456");
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBe(1);
  });

  it("redacts three-segment dotted tokens that do not start with eyJ", () => {
    const nonEyJ = "AbCdEfGh12345678.payload12345678.signature1234";
    const redacted = redactSecrets(`session=${nonEyJ}`);
    expect(redacted).not.toContain(nonEyJ);
    expect(redacted).toContain("[REDACTED]");
  });

  it("does not redact model names, semver, or short dotted identifiers as JWTs", () => {
    // Slash-qualified HF model ids with dots must survive.
    expect(redactSecrets("Qwen/Qwen2.5-0.5B-Instruct")).toBe("Qwen/Qwen2.5-0.5B-Instruct");
    // Short dotted tokens (segments < 8 chars, not eyJ) are not secrets.
    expect(redactSecrets("node.js.org")).toBe("node.js.org");
    expect(redactSecrets("package.json.bak")).toBe("package.json.bak");
    expect(redactSecrets("1.0.0")).toBe("1.0.0");
  });

  it("redacts Windows user paths", () => {
    expect(redactSecrets("C:\\Users\\JohnDoe\\Documents")).toContain("[REDACTED]");
    expect(redactSecrets("C:\\Users\\JohnDoe\\Documents")).not.toContain("JohnDoe");
  });

  it("redacts macOS/Linux user paths", () => {
    expect(redactSecrets("/home/johndoe/file.txt")).toContain("[REDACTED]");
    expect(redactSecrets("/Users/johndoe/file.txt")).toContain("[REDACTED]");
  });

  it("preserves non-secret text", () => {
    const text = "This is a normal log line with no secrets.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });
});

// ── Telemetry collection ─────────────────────────────────────────────────────

describe("collectTelemetry", () => {
  it("collects platform info", () => {
    const result = collectTelemetry(["platform"], {});
    expect(result.platform).toBeDefined();
    expect(result.platform).toContain("OS:");
  });

  it("collects hardware info from probe", () => {
    const probe = {
      probedAt: new Date().toISOString(),
      platform: { os: "win32", arch: "x64", cpuModel: "Test CPU", cpuCores: 8, systemRamGb: 16 },
      nvidia: { gpus: [{ name: "RTX 4090", vramMb: 24576 }] },
      detectedProviders: ["CUDAExecutionProvider"] as const,
      recommendedProvider: "CUDAExecutionProvider" as const,
      notes: [],
    } as const;
    const result = collectTelemetry(["hardware"], { hardwareProbe: probe as unknown as import("@/lib/hardwareProbe").HardwareProbeResult });
    expect(result.hardware).toContain("RTX 4090");
    expect(result.hardware).toContain("Test CPU");
  });

  it("returns fallback when probe is null", () => {
    const result = collectTelemetry(["hardware"], { hardwareProbe: null });
    expect(result.hardware).toBe("Hardware probe not available");
  });

  it("collects recipe info from state", () => {
    const state = {
      hfModelId: "bert-base-uncased",
      ihvProvider: "CUDAExecutionProvider",
      openvinoTargetDevice: "CPU",
      modelSource: "huggingface" as const,
      passes: { conversion: true, quantization: false, pruning: false, onnxTransforms: false },
    } as BuildReportOptions["state"];
    const result = collectTelemetry(["recipe"], { state });
    expect(result.recipe).toContain("bert-base-uncased");
    expect(result.recipe).toContain("CUDAExecutionProvider");
    expect(result.recipe).toContain("Conversion");
  });

  it("collects execution logs", () => {
    const logs = ["line1", "line2", "line3"];
    const result = collectTelemetry(["logs"], { executionLogs: logs });
    expect(result.logs).toContain("line1");
    expect(result.logs).toContain("line3");
  });

  it("truncates logs to last 50 lines", () => {
    const logs = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const result = collectTelemetry(["logs"], { executionLogs: logs });
    expect(result.logs).not.toContain("line0");
    expect(result.logs).toContain("line99");
  });
});

// ── Issue body ───────────────────────────────────────────────────────────────

describe("buildIssueBody", () => {
  const baseReport: IssueReport = {
    category: "bug",
    severity: "blocking",
    area: "execution-batch",
    description: "Olive crashes when running quantization on CUDA.",
    telemetry: {
      platform: "OS: Windows | Arch: x64",
      hardware: "GPU: RTX 4090",
    },
  };

  it("includes category, severity, and area", () => {
    const body = buildIssueBody(baseReport);
    expect(body).toContain("**Category:** Bug report");
    expect(body).toContain("**Severity:** Blocking");
    expect(body).toContain("**Area:** Recipe & run");
  });

  it("includes description", () => {
    const body = buildIssueBody(baseReport);
    expect(body).toContain("Olive crashes when running quantization on CUDA.");
  });

  it("includes telemetry in collapsible details", () => {
    const body = buildIssueBody(baseReport);
    expect(body).toContain("<details>");
    expect(body).toContain("[Platform & OS]");
    expect(body).toContain("OS: Windows");
  });

  it("handles empty description", () => {
    const report = { ...baseReport, description: "" };
    const body = buildIssueBody(report);
    expect(body).toContain("_(no description provided)_");
  });

  it("omits telemetry section when empty", () => {
    const report = { ...baseReport, telemetry: {} };
    const body = buildIssueBody(report);
    expect(body).not.toContain("### Telemetry");
  });

  it("normalizes N/A away from bug reports", () => {
    const body = buildIssueBody({ ...baseReport, severity: "n-a" });
    expect(body).toContain("**Severity:** Annoying");
    expect(body).not.toContain("**Severity:** N/A");
  });

  it("uses N/A for non-bug categories", () => {
    expect(categoryHasSeverity("feature")).toBe(false);
    const body = buildIssueBody({ ...baseReport, category: "feature", severity: "blocking" });
    expect(body).toContain("**Severity:** N/A");
  });
});

// ── Issue title ──────────────────────────────────────────────────────────────

describe("buildIssueTitle", () => {
  it("builds title from category, area, and description snippet", () => {
    const report: IssueReport = {
      category: "bug",
      severity: "annoying",
      area: "recipe-builder",
      description: "The graph view doesn't render nodes correctly when zoomed in.",
      telemetry: {},
    };
    const title = buildIssueTitle(report);
    expect(title).toContain("[Bug report] Model source:");
    expect(title).toContain("graph view");
  });

  it("truncates long descriptions", () => {
    const report: IssueReport = {
      category: "feature",
      severity: "annoying",
      area: "other",
      description: "A".repeat(100),
      telemetry: {},
    };
    const title = buildIssueTitle(report);
    expect(title.length).toBeLessThan(120);
  });

  it("handles multiline descriptions", () => {
    const report: IssueReport = {
      category: "docs",
      severity: "annoying",
      area: "install-venv",
      description: "First line\nSecond line\nThird line",
      telemetry: {},
    };
    const title = buildIssueTitle(report);
    expect(title).not.toContain("\n");
  });
});

// ── GitHub URL ───────────────────────────────────────────────────────────────

describe("buildGitHubIssueUrl", () => {
  it("generates URL with correct repo", () => {
    const report: IssueReport = {
      category: "bug",
      severity: "annoying",
      area: "other",
      description: "Test issue",
      telemetry: {},
    };
    const url = buildGitHubIssueUrl(report);
    expect(url).toContain("https://github.com/tonythethompson/Olive-Studio/issues/new?");
  });

  it("includes title as query param", () => {
    const report: IssueReport = {
      category: "bug",
      severity: "annoying",
      area: "other",
      description: "Test",
      telemetry: {},
    };
    const url = buildGitHubIssueUrl(report);
    expect(url).toContain("title=");
  });

  it("includes labels", () => {
    const report: IssueReport = {
      category: "feature",
      severity: "annoying",
      area: "other",
      description: "Test",
      telemetry: {},
    };
    const url = buildGitHubIssueUrl(report);
    expect(url).toContain("labels=user-report");
    expect(url).toContain("feature");
  });

  it("falls back to canonical issue URL when encoded body exceeds budget", () => {
    const report: IssueReport = {
      category: "bug",
      severity: "blocking",
      area: "execution-batch",
      description: "x".repeat(2500),
      telemetry: {
        logs: Array.from({ length: 50 }, (_, i) => `log-line-${i}-${"y".repeat(80)}`).join("\n"),
      },
    };
    const result = buildReport(report, {});
    expect(result.urlExceededBudget).toBe(true);
    expect(result.url).toBe("https://github.com/tonythethompson/Olive-Studio/issues/new");
    expect(result.fullText).toContain(report.description);
    expect(result.fullText).toContain("log-line-0");
    expect(buildGitHubIssueUrl(report)).toBe(result.url);
  });
});

// ── Full report ──────────────────────────────────────────────────────────────

describe("buildReport", () => {
  it("returns url, body, title, and fullText", () => {
    const report: IssueReport = {
      category: "bug",
      severity: "blocking",
      area: "execution-batch",
      description: "Crash on quantization",
      telemetry: { platform: "OS: Windows" },
    };
    const result = buildReport(report, {});
    expect(result.url).toBeDefined();
    expect(result.body).toBeDefined();
    expect(result.title).toBeDefined();
    expect(result.fullText).toContain("# ");
    expect(result.fullText).toContain("Crash on quantization");
    expect(result.urlExceededBudget).toBe(false);
  });
});
