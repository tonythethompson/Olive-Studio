import fs from "fs";
import { execFileAsync } from "../shared/exec.ts";

export async function getNativeGpuLibPaths(python: string): Promise<string[]> {
  const script = `
import os
from pathlib import Path
dirs = []
try:
    import tensorrt_libs
    dirs.append(os.path.dirname(tensorrt_libs.__file__))
except Exception:
    pass
try:
    import tensorrt_rtx_libs
    dirs.append(os.path.dirname(tensorrt_rtx_libs.__file__))
except Exception:
    pass
try:
    import onnxruntime as ort
    from pathlib import Path
    dirs.append(str(Path(ort.__file__).resolve().parent / "capi"))
except Exception:
    pass
site = Path(__import__("site").getsitepackages()[0])
nvidia = site / "nvidia"
if nvidia.is_dir():
    for child in nvidia.iterdir():
        bin_dir = child / "bin"
        if bin_dir.is_dir():
            dirs.append(str(bin_dir))
print(os.pathsep.join(dirs))
`.trim();
  try {
    const { stdout } = await execFileAsync(python, ["-c", script]);
    return stdout
      .trim()
      .split(process.platform === "win32" ? ";" : ":")
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0 && fs.existsSync(dir));
  } catch {
    return [];
  }
}
