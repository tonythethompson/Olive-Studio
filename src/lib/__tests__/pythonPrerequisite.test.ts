import { describe, expect, it } from "vitest";
import {
  linuxPythonInstallCommand,
  pythonDownloadUrl,
  pythonInstallGuidance,
  OLIVE_PYTHON_WINGET_ID,
} from "../pythonPrerequisite.ts";

describe("pythonPrerequisite", () => {
  it("points each platform at the matching python.org download page", () => {
    expect(pythonDownloadUrl("win32")).toContain("/downloads/windows/");
    expect(pythonDownloadUrl("darwin")).toContain("/downloads/macos/");
    expect(pythonDownloadUrl("linux")).toBe("https://www.python.org/downloads/");
  });

  it("picks a distro install command from os-release", () => {
    expect(linuxPythonInstallCommand('ID=ubuntu\nID_LIKE=debian\n')).toContain("apt install");
    expect(linuxPythonInstallCommand('ID=fedora\n')).toContain("dnf install");
    expect(linuxPythonInstallCommand('ID=arch\n')).toContain("pacman -S");
    expect(linuxPythonInstallCommand('ID=opensuse-tumbleweed\nID_LIKE="suse opensuse"\n')).toContain(
      "zypper install",
    );
    expect(linuxPythonInstallCommand('ID=alpine\n')).toContain("apk add");
  });

  it("offers a one-click install on Windows and a copyable command on Linux", () => {
    const win = pythonInstallGuidance("win32");
    expect(win.canAutoInstall).toBe(true);
    expect(win.command).toContain(OLIVE_PYTHON_WINGET_ID);

    const linux = pythonInstallGuidance("linux", { osReleaseText: "ID=debian\n" });
    expect(linux.canAutoInstall).toBe(false);
    expect(linux.command).toContain("apt install");

    const macNoBrew = pythonInstallGuidance("darwin", { brewPresent: false });
    expect(macNoBrew.canAutoInstall).toBe(false);
    expect(macNoBrew.command).toContain("brew install");

    const macBrew = pythonInstallGuidance("darwin", { brewPresent: true });
    expect(macBrew.canAutoInstall).toBe(true);
  });
});
