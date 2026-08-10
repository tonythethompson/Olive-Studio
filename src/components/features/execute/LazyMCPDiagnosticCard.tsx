import { Component, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { MCPDiagnosticCardProps } from "./MCPDiagnosticCard";

class McpDiagnosticLoadBoundary extends Component<
  { onRetry: () => void; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error | null } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  handleRetry = (): void => {
    this.setState({ error: null });
    this.props.onRetry();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/10 p-4 text-sm text-slate-300">
          <p>Could not load MCP diagnostic tools.</p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-2 inline-flex items-center gap-1.5 text-rose-300 hover:text-rose-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function McpDiagnosticCardLoader({
  loadKey,
  ...props
}: MCPDiagnosticCardProps & { loadKey: number }) {
  const [Card, setCard] = useState<ComponentType<MCPDiagnosticCardProps> | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setLoadError(null);

    import("./MCPDiagnosticCard")
      .then((module) => {
        if (!cancelled) {
          setCard(() => module.MCPDiagnosticCard);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error : new Error(String(error)));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  if (loadError) {
    throw loadError;
  }

  if (!Card) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <Card {...props} />
    </Suspense>
  );
}

/**
 * Lazy-loaded MCP diagnostic card with a local error boundary that can retry
 * failed dynamic imports (React.lazy caches rejections on the module instance).
 */
export function LazyMCPDiagnosticCard(props: MCPDiagnosticCardProps) {
  const [loadKey, setLoadKey] = useState(0);

  return (
    <McpDiagnosticLoadBoundary onRetry={() => setLoadKey((key) => key + 1)}>
      <McpDiagnosticCardLoader loadKey={loadKey} {...props} />
    </McpDiagnosticLoadBoundary>
  );
}
