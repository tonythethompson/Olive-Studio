/**
 * Re-export shared RuntimeEnvStatus from apiClient.
 * Extended here with `error?` for RuntimeEnvControls failed responses.
 */
import type { RuntimeEnvStatus as BaseRuntimeEnvStatus } from "@/lib/apiClient";

export interface RuntimeEnvStatus extends BaseRuntimeEnvStatus {
  error?: string;
}
