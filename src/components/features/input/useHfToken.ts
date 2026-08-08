import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const HF_TOKEN_STATUS_QUERY_KEY = ["hf-token-status"] as const;

export type HfTokenStatusSource = "environment" | "runtime" | "none";
export type HfTokenStatus = HfTokenStatusSource | "loading" | "error";

/**
 * Hugging Face token status + save/clear mutations for the model source panel.
 */
export function useHfToken() {
  const queryClient = useQueryClient();
  const [hfTokenInput, setHfTokenInput] = useState("");

  const hfTokenStatusQuery = useQuery({
    queryKey: HF_TOKEN_STATUS_QUERY_KEY,
    queryFn: async (): Promise<HfTokenStatusSource> => {
      const r = await fetch("/api/env/hf-token-status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const source = d?.source;
      return source === "environment" || source === "runtime" ? source : "none";
    },
    retry: false,
  });
  const hfTokenStatus: HfTokenStatus = hfTokenStatusQuery.isLoading
    ? "loading"
    : hfTokenStatusQuery.isError
      ? "error"
      : (hfTokenStatusQuery.data ?? "none");

  const clearTokenMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/env/hf-token", { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => {
      queryClient.setQueryData(HF_TOKEN_STATUS_QUERY_KEY, "none");
    },
  });

  const submitTokenMutation = useMutation({
    mutationFn: async (token: string) => {
      const r = await fetch("/api/env/hf-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
    onSuccess: () => {
      queryClient.setQueryData(HF_TOKEN_STATUS_QUERY_KEY, "runtime");
      setHfTokenInput("");
      clearTokenMutation.reset();
    },
  });

  const isTokenMutating = submitTokenMutation.isPending || clearTokenMutation.isPending;

  const handleSubmitToken = async () => {
    if (isTokenMutating || !hfTokenInput.trim()) return;
    try {
      await submitTokenMutation.mutateAsync(hfTokenInput.trim());
    } catch {
      /* ignore */
    }
  };

  const handleClearToken = async () => {
    if (isTokenMutating) return;
    try {
      await clearTokenMutation.mutateAsync();
    } catch {
      /* ignore — clearTokenMutation.error is rendered next to the Clear button */
    }
  };

  return {
    hfTokenInput,
    setHfTokenInput,
    hfTokenStatus,
    submitTokenMutation,
    clearTokenMutation,
    isTokenMutating,
    handleSubmitToken,
    handleClearToken,
  };
}
