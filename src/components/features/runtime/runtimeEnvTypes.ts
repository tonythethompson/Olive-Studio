export interface RuntimeEnvStatus {
  venvExists: boolean;
  venvPython: string | null;
  venvScripts: string;
  oliveInstalled: boolean;
  oliveVersion: string | null;
  systemPython: string | null;
  configuredPython: string | null;
  venvOnUserPath: boolean;
  platform: string;
  hint: string;
  error?: string;
  pythonPrerequisite?: {
    downloadUrl: string;
    canAutoInstall: boolean;
    autoInstallLabel: string | null;
    command: string;
  } | null;
}
