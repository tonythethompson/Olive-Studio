/**
 * Shared hardware-probe query. Seven panels render simultaneously on the
 * single-scroll dashboard and each used to fire its own `fetchHardwareProbe()`
 * on mount; routing them through one query key lets React Query dedupe
 * concurrent mounts into a single request and cache the result across
 * navigation.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { fetchHardwareProbe, type HardwareProbeResult } from "@/lib/hardwareProbe";

export const HARDWARE_PROBE_QUERY_KEY = ["hardware-probe"] as const;

export function useHardwareProbe(): UseQueryResult<HardwareProbeResult> {
  return useQuery({
    queryKey: HARDWARE_PROBE_QUERY_KEY,
    queryFn: () => fetchHardwareProbe(false),
    staleTime: 5 * 60 * 1000,
    // fetchHardwareProbe already retries once internally (missing RAM ->
    // forced refresh); RQ's default 3x backoff retry on top would triple
    // real probe invocations (shells out to GPU/TensorRT detection).
    retry: false,
  });
}

/**
 * Forces a fresh probe (bypassing the server-side cache) and publishes the
 * result into the shared query cache so every mounted consumer updates.
 */
export function useRefreshHardwareProbe(): () => Promise<HardwareProbeResult> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    const result = await fetchHardwareProbe(true);
    queryClient.setQueryData(HARDWARE_PROBE_QUERY_KEY, result);
    return result;
  }, [queryClient]);
}
