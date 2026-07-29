/**
 * TensorRT RTX route shim — re-exports from the canonical service module.
 *
 * Used by env routes (POST /api/env/install-tensorrt-rtx) and by the
 * hardware probe (SystemProbeOptions DI).
 */
export {
  probeTensorRtRtxLoadable,
  ensureTensorRtRtx,
  getInstalledTensorRtRtxVersion,
  getTensorRtRtxLibsDir,
} from "../services/olive/tensorrt-rtx.ts";
