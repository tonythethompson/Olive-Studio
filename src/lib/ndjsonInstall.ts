/**
 * Shared NDJSON install stream reader for Hardware panel package installs.
 *
 * Used by TensorRT / TensorRT RTX / OpenVINO install flows that POST to
 * `/api/env/install-*` and stream `{type:"log"|"done"}` frames.
 */

export type NdjsonLogSetter = (updater: string[] | ((prev: string[]) => string[])) => void;

type InstallEvent = { type?: string; message?: string; ok?: boolean; error?: string };

function applyInstallEvent(
  evt: InstallEvent,
  resOk: boolean,
  setLog: NdjsonLogSetter,
  state: { ok: boolean; error?: string },
): void {
  if (evt.type === "log" && evt.message) {
    setLog((prev) => [...prev, evt.message!]);
    return;
  }
  if (evt.type === "done") {
    state.ok = resOk && evt.ok === true;
    state.error = evt.error;
  }
}

function parseAndApplyLine(
  line: string,
  resOk: boolean,
  setLog: NdjsonLogSetter,
  state: { ok: boolean; error?: string },
): void {
  if (!line.trim()) return;
  let evt: InstallEvent;
  try {
    evt = JSON.parse(line) as InstallEvent;
  } catch {
    return;
  }
  applyInstallEvent(evt, resOk, setLog, state);
}

/**
 * POSTs to an install endpoint and consumes either an NDJSON body or a JSON fallback.
 * Flushes any residual unterminated frame after the reader completes.
 */
export async function runNdjsonInstall(url: string, setLog: NdjsonLogSetter): Promise<void> {
  const res = await fetch(url, { method: "POST" });
  const contentType = res.headers.get("content-type") ?? "";
  const state = { ok: false, error: undefined as string | undefined };

  if (contentType.includes("ndjson") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        parseAndApplyLine(line, res.ok, setLog, state);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      parseAndApplyLine(buffer, res.ok, setLog, state);
    }
  } else {
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      lines?: string[];
      log?: string[];
    };
    const lines = data.lines ?? data.log;
    if (Array.isArray(lines)) setLog(lines);
    state.ok = res.ok && data.ok === true;
    state.error = data.error;
  }

  if (!state.ok) {
    throw new Error(state.error ?? `Install failed (HTTP ${res.status})`);
  }
}
