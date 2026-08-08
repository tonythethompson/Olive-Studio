/**
 * AMD ROCm dependency links and detection helpers.
 */

export const ROCM_DOWNLOAD_LINKS = {
  install: "https://rocm.docs.amd.com/projects/install-on-linux/en/latest/",
  windows: "https://rocm.docs.amd.com/en/latest/deploy/windows/quick_start.html",
  compatibility: "https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html",
} as const;

/**
 * Returns the most appropriate ROCm download/install URL for the running OS.
 */
export function rocmDownloadUrlForOs(os: string | undefined | null): string {
  const text = (os ?? "").toLowerCase();
  if (/\bwin(?:32|dows)?\b/.test(text)) return ROCM_DOWNLOAD_LINKS.windows;
  return ROCM_DOWNLOAD_LINKS.install;
}
