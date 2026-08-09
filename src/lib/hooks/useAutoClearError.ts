/**
 * Auto-clearing error state hook.
 */
import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Auto-clearing error state hook.
 *
 * Returns an error string and a setter that automatically clears the error
 * after `timeoutMs` (default 4 s). The timer is cleaned up on unmount so
 * we never call setState on an unmounted component.
 *
 * Usage:
 * ```ts
 * const [error, setError] = useAutoClearError(4000);
 * // to show an error:
 * setError("Something went wrong");
 * // to clear immediately:
 * setError("");
 * ```
 */
export function useAutoClearError(timeoutMs = 4000): [string, (msg: string) => void] {
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up pending timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const setErrorWithAutoClear = useCallback(
    (msg: string) => {
      // Cancel any pending clear
      if (timerRef.current !== null) clearTimeout(timerRef.current);

      setError(msg);

      // Only schedule a clear for non-empty messages
      if (msg !== "") {
        timerRef.current = setTimeout(() => {
          setError("");
          timerRef.current = null;
        }, timeoutMs);
      }
    },
    [timeoutMs],
  );

  return [error, setErrorWithAutoClear];
}
