import type { McpDiagnostic } from "@/types";

/** Studio-local diagnostic with log evidence for the Diagnose card. */
export type LocalLogDiagnostic = McpDiagnostic & {
  evidence: string[];
  /** 0-based indices into the log array used for diagnosis (when known). */
  evidenceIndices?: number[];
};

const STUDIO_HF_TASK_SPEECH = "studio-hf-task-speech-recognition";

/**
 * Match well-known Olive Studio / Transformers failures in run logs.
 * Runs before (or instead of) MCP KB lookup so Diagnose is useful offline
 * and for bugs the KB has not indexed.
 */
export function matchLocalLogDiagnostic(logs: string[]): LocalLogDiagnostic | null {
  if (logs.length === 0) return null;
  const joined = logs.join("\n");

  const unknownTask =
    /KeyError:\s*["']Unknown task\s+([^\s"']+)/i.exec(joined) ||
    /Unknown task\s+([^\s,]+).*available tasks are/i.exec(joined);

  if (unknownTask) {
    const badTask = unknownTask[1]!.replace(/,$/, "");
    const evidenceIndices: number[] = [];
    const evidence: string[] = [];
    for (let i = 0; i < logs.length; i++) {
      const line = logs[i]!;
      if (
        /Unknown task|KeyError|check_task|automatic-speech-recognition|speech-recognition|No output model produced/i.test(
          line,
        )
      ) {
        evidenceIndices.push(i);
        evidence.push(line.trim());
      }
    }
    if (evidence.length === 0) {
      evidence.push(unknownTask[0]!.slice(0, 240));
    }

    if (badTask === "speech-recognition" || /\bspeech-recognition\b/i.test(joined)) {
      return {
        matched_entry: STUDIO_HF_TASK_SPEECH,
        domain: "studio",
        title: "Invalid Hugging Face task: speech-recognition",
        root_cause:
          "The CUDA/Olive recipe set HfModel task to `speech-recognition`. Transformers only accepts `automatic-speech-recognition` for Whisper/ASR (see pipeline check_task). Olive then reports exit 0 with “No output model produced”.",
        workaround:
          "Olive Studio now emits `automatic-speech-recognition` for Whisper. Rebuild the recipe (open Execute so it regenerates JSON), keep CUDAExecutionProvider if you want CUDA, then run Execute Live again.",
        applyable: true,
        // Sentinel so Apply Fix is enabled; mapped specially in apply path.
        updated_config: { studio_fix: "hf_task_automatic_speech_recognition" },
        relevant_quirks: [],
        evidence: evidence.slice(0, 8),
        evidenceIndices,
      };
    }

    return {
      matched_entry: "studio-hf-unknown-task",
      domain: "studio",
      title: `Unknown Hugging Face task: ${badTask}`,
      root_cause: `Transformers rejected task \`${badTask}\` in check_task.`,
      workaround: `Set input_model.config.task to a supported id (for Whisper/ASR use \`automatic-speech-recognition\`). Available tasks are listed in the KeyError message.`,
      applyable: false,
      evidence: evidence.slice(0, 8),
      evidenceIndices,
    };
  }

  if (/No output model produced/i.test(joined)) {
    const evidence = logs
      .filter((l) => /No output model produced|Traceback|KeyError|WARNING/i.test(l))
      .slice(-6);
    return {
      matched_entry: "olive-no-output-model",
      domain: "olive",
      title: "No output model produced",
      root_cause:
        "Olive finished without writing an optimized model (often after an earlier exception). Exit code can still be 0.",
      workaround:
        "Scroll up for the first Traceback/KeyError and fix that cause, then re-run. For Whisper, ensure input_model.config.task is `automatic-speech-recognition`.",
      applyable: false,
      evidence: evidence.length > 0 ? evidence.map((l) => l.trim()) : ["No output model produced."],
    };
  }

  return null;
}

export function isStudioHfTaskSpeechFix(diagnostic: { matched_entry?: string | null } | null): boolean {
  return diagnostic?.matched_entry === STUDIO_HF_TASK_SPEECH;
}

/** True when logs look like a hard failure even if the process exited 0. */
export function logsIndicateFailure(logs: string[]): boolean {
  return logs.some(
    (line) =>
      /\bTraceback \(most recent call last\):/i.test(line) ||
      /\bKeyError:\s*/i.test(line) ||
      /\bException:\s*/i.test(line) ||
      /\[ERROR\]/i.test(line) ||
      /\bFAILED\b/.test(line) ||
      /No output model produced/i.test(line),
  );
}

/**
 * Expand a sparse line selection (e.g. one traceback frame) to nearby context
 * so Diagnose sees the KeyError / summary lines.
 */
export function expandLogSelection(logs: string[], selectedIndices: number[], radius = 6): string[] {
  if (selectedIndices.length === 0) return logs;
  const include = new Set<number>();
  for (const idx of selectedIndices) {
    for (let i = Math.max(0, idx - radius); i <= Math.min(logs.length - 1, idx + radius); i++) {
      include.add(i);
    }
  }
  // Always pull failure anchors into the snippet.
  for (let i = 0; i < logs.length; i++) {
    if (
      /KeyError|Unknown task|Traceback \(most recent call last\)|No output model produced/i.test(logs[i]!)
    ) {
      include.add(i);
    }
  }
  return Array.from(include)
    .sort((a, b) => a - b)
    .map((i) => logs[i]!);
}
