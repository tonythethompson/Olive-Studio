/**
 * OpenVINO route shim — re-exports from the canonical service module.
 *
 * Used by env routes (POST /api/env/install-openvino) and by the
 * hardware probe (SystemProbeOptions DI).
 */
export { probeOpenVino, ensureOpenVino } from "../services/olive/openvino.ts";
