import React, { type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);

    (this as Record<string, unknown>).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { hasError: true, error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const label = ((this as Record<string, unknown>).props as ErrorBoundaryProps).label;
    console.error(`[ErrorBoundary${label ? `:${label}` : ""}]`, error, info);
    ((this as Record<string, unknown>).props as ErrorBoundaryProps).onError?.(error, info);
  }

  handleRetry = (): void => {
    (this as unknown as { setState: (s: Partial<ErrorBoundaryState>) => void }).setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    const state = (this as unknown as { state: ErrorBoundaryState }).state;
    const props = (this as unknown as { props: ErrorBoundaryProps }).props;

    if (state.hasError) {
      return (
        <div className="flex items-center justify-center p-8 rounded-lg border border-rose-500/30 bg-rose-950/10 m-4">
          <div className="flex flex-col items-center gap-3 text-center max-w-md">
            <AlertTriangle className="h-8 w-8 text-rose-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-rose-200">
                {props.label ?? "Section"} encountered an error
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {state.error?.message || "An unexpected error occurred. This is likely a temporary issue."}
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 hover:text-rose-200 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      );
    }
    return props.children;
  }
}
