import { describe, it, expect } from "vitest";
import {
  expandLogSelection,
  isStudioHfTaskSpeechFix,
  logsIndicateFailure,
  matchLocalLogDiagnostic,
} from "./logFailurePatterns.ts";

const WHISPER_LOG = [
  "Running conversion...",
  "Traceback (most recent call last):",
  '  File "transformers/pipelines/base.py", line 1358, in check_task',
  "KeyError: \"Unknown task speech-recognition, available tasks are ['automatic-speech-recognition', ...]\"",
];

describe("matchLocalLogDiagnostic", () => {
  it("detects Whisper speech-recognition KeyError with applyable studio fix", () => {
    const d = matchLocalLogDiagnostic(WHISPER_LOG);
    expect(d).not.toBeNull();
    expect(isStudioHfTaskSpeechFix(d)).toBe(true);
    expect(d!.applyable).toBe(true);
    expect(d!.workaround).toMatch(/automatic-speech-recognition/);
    expect(d!.evidence.some((e) => /KeyError|Unknown task/i.test(e))).toBe(true);
  });

  it("does not treat non-speech unknown tasks as the speech studio fix", () => {
    const logs = [
      "KeyError: \"Unknown task image-classification, available tasks are ['automatic-speech-recognition', ...]\"",
    ];
    const d = matchLocalLogDiagnostic(logs);
    expect(d).not.toBeNull();
    expect(d!.matched_entry).toBe("studio-hf-unknown-task");
    expect(d!.applyable).toBe(false);
    expect(isStudioHfTaskSpeechFix(d)).toBe(false);
  });
});

describe("logsIndicateFailure", () => {
  it("flags traceback/KeyError/no-output logs", () => {
    expect(logsIndicateFailure(WHISPER_LOG)).toBe(true);
    expect(logsIndicateFailure(["[WARNING] No output model produced. Please check the log"])).toBe(true);
    expect(logsIndicateFailure(["all good"])).toBe(false);
  });
});

describe("expandLogSelection", () => {
  it("includes KeyError even when only a middle frame is selected", () => {
    const selected = expandLogSelection(WHISPER_LOG, [2], 1);
    expect(selected.some((l) => /KeyError/i.test(l))).toBe(true);
  });
});
