/**
 * Shared Python prerequisite constants and install guidance.
 * Used by the Runtime UI and the server (no Node-only APIs).
 */

export const OLIVE_PYTHON_MIN = "3.10";
export const OLIVE_PYTHON_MAX = "3.13";
export const OLIVE_PYTHON_RECOMMENDED = "3.12";
export const OLIVE_PYTHON_WINGET_ID = "Python.Python.3.12";
export const OLIVE_PYTHON_BREW_FORMULA = "python@3.12";

export const PYTHON_DOWNLOAD_URL = "https://www.python.org/downloads/";
export const PYTHON_DOWNLOAD_URL_WINDOWS = "https://www.python.org/downloads/windows/";
export const PYTHON_DOWNLOAD_URL_MACOS = "https://www.python.org/downloads/macos/";

export type PythonInstallGuidance = {
  downloadUrl: string;
  canAutoInstall: boolean;
  autoInstallLabel: string | null;
  command: string;
};

/** Preferred CPython minors for Olive, 3.12 first. */
export const PREFERRED_PYTHON_MINORS = [12, 11, 13, 10] as const;

export function pythonDownloadUrl(platform: string): string {
  if (platform === "win32") return PYTHON_DOWNLOAD_URL_WINDOWS;
  if (platform === "darwin") return PYTHON_DOWNLOAD_URL_MACOS;
  return PYTHON_DOWNLOAD_URL;
}

/**
 * Distro install command from /etc/os-release ID / ID_LIKE.
 * Uses the distro default python3 (3.10+ on current LTS releases) so we do
 * not recommend a 3.12 package that is missing from older Ubuntu/Debian repos.
 */
export function linuxPythonInstallCommand(osReleaseText: string): string {
  const id = matchOsReleaseField(osReleaseText, "ID");
  const idLike = matchOsReleaseField(osReleaseText, "ID_LIKE");
  const blob = `${id} ${idLike}`;

  if (/\b(fedora|rhel|centos|rocky|alma|amzn)\b/.test(blob)) {
    return "sudo dnf install -y python3 python3-pip";
  }
  if (/\b(arch|manjaro|endeavouros)\b/.test(blob)) {
    return "sudo pacman -S --needed python python-pip";
  }
  if (/\b(opensuse|sles)\b/.test(blob)) {
    return "sudo zypper install -y python3 python3-pip";
  }
  if (/\b(alpine)\b/.test(blob)) {
    return "sudo apk add python3 py3-pip";
  }
  return "sudo apt update && sudo apt install -y python3 python3-venv python3-pip";
}

export function matchOsReleaseField(text: string, field: string): string {
  const re = new RegExp(`^${field}=\\s*"?([^"\\n]+)"?`, "im");
  const m = text.match(re);
  return (m?.[1] ?? "").trim().toLowerCase();
}

export function pythonInstallGuidance(
  platform: string,
  opts?: { brewPresent?: boolean; osReleaseText?: string },
): PythonInstallGuidance {
  const downloadUrl = pythonDownloadUrl(platform);

  if (platform === "win32") {
    return {
      downloadUrl,
      canAutoInstall: true,
      autoInstallLabel: `Install Python ${OLIVE_PYTHON_RECOMMENDED}`,
      command: `winget install -e --id ${OLIVE_PYTHON_WINGET_ID}`,
    };
  }

  if (platform === "darwin") {
    const brewPresent = Boolean(opts?.brewPresent);
    return {
      downloadUrl,
      canAutoInstall: brewPresent,
      autoInstallLabel: brewPresent ? `Install Python ${OLIVE_PYTHON_RECOMMENDED}` : null,
      command: `brew install ${OLIVE_PYTHON_BREW_FORMULA}`,
    };
  }

  return {
    downloadUrl,
    canAutoInstall: false,
    autoInstallLabel: null,
    command: linuxPythonInstallCommand(opts?.osReleaseText ?? ""),
  };
}
