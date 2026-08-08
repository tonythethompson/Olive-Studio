import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Bot, RefreshCw, Shield } from "lucide-react";

export type AgentAccessPolicyState = {
  mcpAccess: boolean;
  allowJobInspection: boolean;
  allowRecipeChanges: boolean;
  allowJobSubmission: boolean;
  allowJobCancellation: boolean;
  envOverrideActive?: boolean;
  source?: string;
};

type PolicyKey = keyof Pick<
  AgentAccessPolicyState,
  | "mcpAccess"
  | "allowJobInspection"
  | "allowRecipeChanges"
  | "allowJobSubmission"
  | "allowJobCancellation"
>;

const TOGGLES: { key: PolicyKey; label: string; hint: string; danger?: boolean }[] = [
  {
    key: "mcpAccess",
    label: "MCP access",
    hint: "Master switch for agent bridge features",
  },
  {
    key: "allowJobInspection",
    label: "Job inspection",
    hint: "List/get job status and metadata results",
  },
  {
    key: "allowRecipeChanges",
    label: "Recipe changes",
    hint: "Reserved for future agent recipe write-back",
  },
  {
    key: "allowJobSubmission",
    label: "Job submission",
    hint: "Allow agents to start Olive runs (also permits polling those MCP jobs)",
    danger: true,
  },
  {
    key: "allowJobCancellation",
    label: "Job cancellation",
    hint: "Allow agents to cancel running jobs",
    danger: true,
  },
];

function isBrowserLoopbackHost(): boolean {
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

function formatAgentAccessError(status: number, serverError: string | undefined): string {
  if (status === 403) {
    return "Policy changes require opening Studio on localhost (127.0.0.1).";
  }
  return serverError ?? `HTTP ${status}`;
}

/**
 * Header control: Studio-owned agent/MCP access policy (Phase 3).
 * Reads GET /api/olive/agent-access from any Studio session; writes (PUT) are
 * loopback-only on the server. Env overrides (e.g. OLIVE_MCP_ALLOW_JOBS) may
 * still force submit/cancel — UI shows when that is active.
 */
export const AgentAccessControls = memo(function AgentAccessControls() {
  const [policy, setPolicy] = useState<AgentAccessPolicyState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstToggleRef = useRef<HTMLInputElement | null>(null);
  const canMutatePolicy = isBrowserLoopbackHost();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/olive/agent-access");
      const data = (await res.json()) as {
        ok?: boolean;
        policy?: AgentAccessPolicyState;
        error?: string;
      };
      if (!res.ok) throw new Error(formatAgentAccessError(res.status, data.error));
      if (!data.policy) throw new Error("Missing policy payload");
      setPolicy(data.policy);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateMenuPos = useCallback(() => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const menuWidth = Math.min(window.innerWidth - 32, 22 * 16);
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - menuWidth - 16);
    setMenuPos({ top: rect.bottom + 8, left });
  }, []);

  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      setMessage(null);
      setError(null);
      return;
    }
    updateMenuPos();
    // Snapshot the opener node for cleanup; triggerRef.current may change later.
    const triggerEl = triggerRef.current;
    // Move focus into the dialog for keyboard users; restore on close below.
    const focusTimer = window.setTimeout(() => {
      firstToggleRef.current?.focus();
    }, 0);
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        const menu = document.getElementById("agent-access-menu");
        if (menu?.contains(event.target as Node)) return;
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", updateMenuPos);
    window.addEventListener("scroll", updateMenuPos, { capture: true, passive: true });
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", updateMenuPos);
      window.removeEventListener("scroll", updateMenuPos, { capture: true });
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to the opener when the dialog unmounts/closes.
      triggerEl?.focus();
    };
  }, [open, updateMenuPos]);

  const patchPolicy = async (key: PolicyKey, value: boolean) => {
    if (!canMutatePolicy) {
      setError("Policy changes require opening Studio on localhost (127.0.0.1).");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/olive/agent-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        policy?: AgentAccessPolicyState;
        error?: string;
      };
      if (!res.ok) throw new Error(formatAgentAccessError(res.status, data.error));
      if (!data.policy) throw new Error("Missing policy payload");
      setPolicy(data.policy);
      setMessage("Saved.");
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitOn = Boolean(policy?.allowJobSubmission);
  const cancelOn = Boolean(policy?.allowJobCancellation);
  const elevated = Boolean(policy?.mcpAccess) && (submitOn || cancelOn);

  const title = elevated
    ? "Agent access: job submission or cancellation is enabled"
    : "Agent / MCP access policy";

  return (
    <div ref={rootRef} className="relative text-xs font-mono overflow-visible">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors px-1.5 py-1 rounded border border-transparent hover:border-slate-700/80"
        title={title}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? "agent-access-menu" : undefined}
        aria-label={title}
      >
        <Bot className="h-3 w-3 text-slate-500" aria-hidden />
        <span className={elevated ? "text-amber-400/90 flex items-center gap-0.5" : "text-slate-400"}>
          {elevated ? <Shield className="h-3 w-3" aria-hidden /> : null}
          Agent access
        </span>
      </button>

      {open && menuPos && (
        <div
          id="agent-access-menu"
          role="dialog"
          aria-label="Agent and MCP access settings"
          style={{ top: menuPos.top, left: menuPos.left }}
          className="fixed z-50 w-[min(100vw-2rem,22rem)] rounded border border-slate-700 bg-slate-900 shadow-xl p-3 space-y-3 text-left"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-slate-200 font-sans">Agent / MCP access</div>
              <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed font-sans">
                Controls what coding agents may do through Olive MCP. Studio always owns execution;
                agents never spawn Olive directly.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-slate-500 hover:text-electric-blue p-0.5"
              title="Refresh"
              aria-label="Refresh agent access policy"
            >
              <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            </button>
          </div>

          {!canMutatePolicy ? (
            <p className="text-[11px] text-slate-300 font-sans rounded border border-slate-600/50 bg-slate-800/60 px-2 py-1.5">
              Read-only here. Open Studio on <code className="font-mono">http://127.0.0.1:3000</code> to
              change these toggles.
            </p>
          ) : null}

          {policy?.envOverrideActive ? (
            <p className="text-[11px] text-amber-300/90 font-sans rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
              Server env override active (e.g. <code className="font-mono">OLIVE_MCP_ALLOW_JOBS</code>
              ). Effective permissions may be higher than these toggles.
            </p>
          ) : null}

          <ul className="space-y-2">
            {TOGGLES.map(({ key, label, hint, danger }, index) => {
              const checked = Boolean(policy?.[key]);
              const disabled =
                busy ||
                !policy ||
                !canMutatePolicy ||
                (key !== "mcpAccess" && policy.mcpAccess === false);
              return (
                <li key={key} className="flex items-start gap-2">
                  <input
                    ref={index === 0 ? firstToggleRef : undefined}
                    id={`agent-access-${key}`}
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-600 bg-slate-950 text-electric-blue focus:ring-electric-blue/40"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => void patchPolicy(key, e.target.checked)}
                  />
                  <label htmlFor={`agent-access-${key}`} className="min-w-0 font-sans cursor-pointer">
                    <span
                      className={`text-xs font-medium ${
                        danger && checked ? "text-amber-300" : "text-slate-200"
                      }`}
                    >
                      {label}
                    </span>
                    <span className="block text-[11px] text-slate-500 leading-snug">{hint}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          {message ? <p className="text-[11px] text-emerald-400 font-sans">{message}</p> : null}
          {error ? <p className="text-[11px] text-rose-400 font-sans">{error}</p> : null}

          <p className="text-[11px] text-slate-500 font-sans leading-relaxed border-t border-slate-800 pt-2">
            External agents need <code className="font-mono text-slate-400">OLIVE_STUDIO_API_URL</code>{" "}
            pointing at this Studio (e.g. <code className="font-mono text-slate-400">http://127.0.0.1:3000</code>
            ).
          </p>
        </div>
      )}
    </div>
  );
});
