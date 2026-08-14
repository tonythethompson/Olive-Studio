/** Button copy for RuntimeEnvControls — kept out of the component body. */

export function runtimeNeedsAttention(status: {
  systemPython: string | null;
  oliveInstalled: boolean;
  venvExists: boolean;
} | null): boolean {
  return Boolean(status && (!status.systemPython || !status.oliveInstalled || !status.venvExists));
}

export function runtimeTitleFor(
  status: { oliveInstalled: boolean; oliveVersion: string | null } | null,
  needsAttention: boolean,
): string {
  if (status?.oliveInstalled) return `Olive ${status.oliveVersion ?? "ready"} in project .venv`;
  if (needsAttention) {
    return "Python / Olive runtime needs setup. Click to install the project venv or set a Python path";
  }
  return "Python / Olive runtime and PATH";
}

export function runtimeLabelFor(
  status: { oliveInstalled: boolean; oliveVersion: string | null } | null,
  needsAttention: boolean,
): string {
  if (status?.oliveInstalled) return `Olive ${status.oliveVersion ?? "ok"}`;
  return needsAttention ? "Setup runtime" : "Runtime";
}
