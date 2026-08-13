import { useCallback, useEffect, useRef, useState } from "react";
import type { PassGuidance } from "@/lib/passGuidance";
import {
  parseMcpPassParamsPayload,
  type McpPassParamsPayload,
} from "@/lib/mcpParamValidation";
import { CheckCircle2, XCircle, Database, ChevronDown, ChevronRight } from "lucide-react";

interface PassGuidanceCardProps {
  guidance: PassGuidance;
}

/**
 * Displays guidance for a pass and optionally provides expandable MCP parameter documentation.
 *
 * @param guidance - The pass title, description, usage conditions, and optional pass name used to load parameter documentation.
 */
export function PassGuidanceCard({ guidance }: PassGuidanceCardProps) {
  const [params, setParams] = useState<McpPassParamsPayload | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [paramsExpanded, setParamsExpanded] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchParams = useCallback(() => {
    if (!guidance.passName) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setHasFetched(false);
    setNetworkError(false);
    setParams(null);
    fetch("/api/mcp/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "get_pass_parameters",
        args: { pass_name: guidance.passName },
      }),
      signal: controller.signal,
    })
      .then(async (r) => {
        const data: unknown = await r.json();
        if (controller.signal.aborted) return;
        const parsed = parseMcpPassParamsPayload(r.ok, data);
        if (!parsed.ok) {
          setParams(null);
          setHasFetched(true);
          setNetworkError(true);
          return;
        }
        setParams(parsed.data);
        setHasFetched(true);
        setNetworkError(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setParams(null);
        setHasFetched(true);
        setNetworkError(true);
      });
  }, [guidance.passName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchParams is async; setState only in .then/.catch
    fetchParams();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchParams]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- collapse-by-default when the selected node changes
    setAboutExpanded(false);
  }, [guidance.title]);

  const isLoading = guidance.passName != null && !hasFetched;
  const hasParams = params && !params.error && params.parameters && Object.keys(params.parameters).length > 0;
  const requiredParams = params?.required_params ?? [];
  const optionalParams: Array<[string, NonNullable<McpPassParamsPayload["parameters"]>[string]]> = hasParams
    ? (Object.entries(params!.parameters!).filter(([k]) => !requiredParams.includes(k)) as Array<
        [string, NonNullable<McpPassParamsPayload["parameters"]>[string]]
      >)
    : [];

  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-950/50 p-4 space-y-4">
      <div>
        <button
          type="button"
          onClick={() => setAboutExpanded((v) => !v)}
          aria-expanded={aboutExpanded}
          className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-electric-blue/80 hover:text-electric-blue transition-colors cursor-pointer w-full mb-1"
        >
          <span>About this pass</span>
          {aboutExpanded ? (
            <ChevronDown className="h-3 w-3 ml-auto" />
          ) : (
            <ChevronRight className="h-3 w-3 ml-auto" />
          )}
        </button>
        <h4 className="text-sm font-semibold text-slate-100 leading-snug">{guidance.title}</h4>
        {aboutExpanded && (
          <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">{guidance.summary}</p>
        )}
      </div>

      {aboutExpanded && (
        <>
          <p className="text-sm text-slate-500 leading-relaxed border-l-2 border-slate-700 pl-3">
            {guidance.whatItDoes}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-500/90 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Use when
              </p>
              <ul className="space-y-1.5">
                {guidance.whenToUse.map((item) => (
                  <li key={item} className="text-sm text-slate-400 leading-relaxed pl-0.5">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {guidance.whenNotToUse.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-mono uppercase tracking-wider text-amber-500/90 flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5" />
                  Skip when
                </p>
                <ul className="space-y-1.5">
                  {guidance.whenNotToUse.map((item) => (
                    <li key={item} className="text-sm text-slate-500 leading-relaxed pl-0.5">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      {/* MCP Parameter Documentation */}
      {guidance.passName && (
        <div className="border-t border-slate-800/60 pt-3">
          <button
            type="button"
            onClick={() => setParamsExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-electric-blue/70 hover:text-electric-blue transition-colors cursor-pointer w-full"
          >
            <Database className="h-3 w-3" />
            <span>Olive Parameters: {guidance.passName}</span>
            {isLoading && <span className="text-slate-500 ml-1 animate-pulse">loading...</span>}
            {!isLoading &&
              (paramsExpanded ? (
                <ChevronDown className="h-3 w-3 ml-auto" />
              ) : (
                <ChevronRight className="h-3 w-3 ml-auto" />
              ))}
          </button>

          {paramsExpanded && hasParams && (
            <div className="mt-2 space-y-2.5">
              {params!.description && (
                <p className="text-xs text-slate-400 leading-relaxed">{params!.description}</p>
              )}

              {requiredParams.length > 0 && (
                <div>
                  <p className="text-[11px] font-mono text-rose-400/80 mb-1">Required</p>
                  <div className="space-y-1">
                    {requiredParams.map((name) => {
                      const doc = params!.parameters![name];
                      return (
                        <div key={name} className="flex gap-2 text-xs">
                          <span className="font-mono text-slate-300 shrink-0">{name}</span>
                          {doc?.type && (
                            <span className="text-slate-500 font-mono text-[11px]">:{doc.type}</span>
                          )}
                          {doc?.description && <span className="text-slate-400">: {doc.description}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {optionalParams.length > 0 && (
                <div>
                  <p className="text-[11px] font-mono text-slate-500 mb-1">Optional</p>
                  <div className="space-y-1.5">
                    {optionalParams.map(([name, doc]) => (
                      <div
                        key={name}
                        className="rounded bg-slate-900/50 px-2 py-1.5 border border-slate-800/40"
                      >
                        <div className="flex gap-2 text-xs items-baseline">
                          <span className="font-mono text-slate-300 shrink-0">{name}</span>
                          {doc.type && (
                            <span className="text-slate-500 font-mono text-[11px]">:{doc.type}</span>
                          )}
                          {doc.default !== undefined && (
                            <span className="text-slate-600 font-mono text-[11px]">
                              default: {JSON.stringify(doc.default)}
                            </span>
                          )}
                        </div>
                        {doc.description && (
                          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                            {doc.description}
                          </p>
                        )}
                        {doc.valid_range && (
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                            range: {doc.valid_range}
                          </p>
                        )}
                        {doc.interactions && (
                          <p className="text-[11px] text-amber-500/70 mt-0.5">⚠ {doc.interactions}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {params!.gotchas && params!.gotchas!.length > 0 && (
                <div>
                  <p className="text-[11px] font-mono text-amber-400/80 mb-1">Gotchas</p>
                  <ul className="space-y-0.5">
                    {params!.gotchas!.map((g, i) => (
                      <li
                        key={i}
                        className="text-[11px] text-amber-500/70 leading-relaxed pl-2 border-l border-amber-500/20"
                      >
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {paramsExpanded && networkError && !isLoading && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] text-amber-400/80 font-mono">Failed to load parameters</p>
              <button
                type="button"
                onClick={fetchParams}
                className="text-[11px] text-electric-blue/80 hover:text-electric-blue transition-colors font-mono cursor-pointer"
              >
                ↻ Retry
              </button>
            </div>
          )}

          {paramsExpanded && !hasParams && !networkError && !isLoading && (
            <p className="text-[11px] text-slate-500 mt-2 italic">
              No parameter documentation available for this pass.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
