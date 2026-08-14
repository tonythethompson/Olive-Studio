/** NDJSON install-stream helper used by RuntimeEnvControls. */

export type InstallStreamResult = {
  ok: boolean;
  error?: string;
  message?: string;
  command?: string;
  downloadUrl?: string;
};

export type InstallStreamEvent = {
  type?: string;
  message?: string;
  ok?: boolean;
  error?: string;
  command?: string;
  downloadUrl?: string;
};

export type InstallStreamAcc = {
  finalOk: boolean | null;
  finalError?: string;
  lastLog: string;
  command?: string;
  downloadUrl?: string;
};

export function parseInstallStreamEvent(line: string): InstallStreamEvent | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as InstallStreamEvent;
  } catch {
    return null;
  }
}

export function applyInstallStreamEvent(
  acc: InstallStreamAcc,
  evt: InstallStreamEvent,
  onLog?: (message: string) => void,
): void {
  if (evt.type === "log" && evt.message) {
    acc.lastLog = evt.message;
    onLog?.(evt.message);
    return;
  }
  if (evt.type !== "done") return;
  acc.finalOk = evt.ok !== false;
  acc.finalError = evt.error || (evt.ok === false ? evt.message : undefined);
  acc.command = evt.command;
  acc.downloadUrl = evt.downloadUrl;
  if (evt.message) acc.lastLog = evt.message;
}

function finishInstallStream(acc: InstallStreamAcc, res: Response, fallbackError: string): InstallStreamResult {
  // Never surface a progress `log` as the failure. Interrupted streams have no
  // `done`, so lastLog is the last progress line and must not become the error.
  if (acc.finalOk === null) {
    throw new Error(fallbackError);
  }
  if (!res.ok || !acc.finalOk) {
    return {
      ok: false,
      error: acc.finalError || fallbackError,
      command: acc.command,
      downloadUrl: acc.downloadUrl,
    };
  }
  return { ok: true, message: acc.lastLog, command: acc.command, downloadUrl: acc.downloadUrl };
}

export async function consumeInstallNdjson(
  res: Response,
  fallbackError: string,
  onLog?: (message: string) => void,
): Promise<InstallStreamResult> {
  if (!res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? (res.status === 404 ? "API route not found." : `HTTP ${res.status}`));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const acc: InstallStreamAcc = { finalOk: null, lastLog: fallbackError };
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const evt = parseInstallStreamEvent(line);
      if (evt) applyInstallStreamEvent(acc, evt, onLog);
    }
    if (done) break;
  }

  const trailing = parseInstallStreamEvent(buf);
  if (trailing) applyInstallStreamEvent(acc, trailing, onLog);
  return finishInstallStream(acc, res, fallbackError);
}
