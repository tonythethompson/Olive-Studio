/**
 * TensorRT route shim — re-exports from the canonical service modules.
 *
 * Used by env routes (POST /api/env/install-tensorrt[-rtx]) and by the
 * hardware probe (SystemProbeOptions DI).
 */
export {
  probeTensorRtRtxLoadable,
  ensureTensorRtRtx,
  getInstalledTensorRtRtxVersion,
  getTensorRtRtxLibsDir,
} from "../services/olive/tensorrt-rtx.ts";

export {
  probeTensorRtLoadable,
  ensureTensorRt,
  getInstalledTensorRtVersion,
  getTensorRtLibsDir,
} from "../services/olive/tensorrt.ts";
