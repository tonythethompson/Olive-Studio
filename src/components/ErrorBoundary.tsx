import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Bug } from "lucide-react";
import { errorFrequency, formatFrequencyDisplay, type ErrorFrequencyInfo } from "@/lib/errorFrequency";

interface ErrorBoundaryProps {
  children: ReactNode;
  label?: string;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  onReportError?: (details: {
    error: Error;
    label?: string;
    componentStack?: string;
    frequencyInfo?: ErrorFrequencyInfo;
  }) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  frequencyInfo: ErrorFrequencyInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps, context?: unknown) {
    super(props, context);
    this.state = { hasError: false, error: null, frequencyInfo: null };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { hasError: true, error: error instanceof Error ? error : new Error(String(error)), frequencyInfo: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.label;
    console.error(`[ErrorBoundary${label ? `:${label}` : ""}]`, error, info);
    this.props.onError?.(error, info);

    // Track error frequency
    const frequencyInfo = errorFrequency.recordError(label ?? "unknown", error.message);
    this.setState({ frequencyInfo });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, frequencyInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center p-8 rounded-lg border border-rose-500/30 bg-rose-950/10 m-4">
          <div className="flex flex-col items-center gap-3 text-center max-w-md">
            <AlertTriangle className="h-8 w-8 text-rose-400 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-rose-200">
                {this.props.label ?? "Section"} encountered an error
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                {this.state.error?.message ||
                  "An unexpected error occurred. This is likely a temporary issue."}
              </p>
              {this.state.frequencyInfo && this.state.frequencyInfo.count > 1 && (
                <p className="text-xs text-amber-400/80 mt-2 font-medium">
                  {formatFrequencyDisplay(this.state.frequencyInfo)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 hover:text-rose-200 transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
              {this.props.onReportError && (
                <button
                  type="button"
                  onClick={() =>
                    this.props.onReportError!({
                      error: this.state.error!,
                      label: this.props.label,
                      componentStack: this.state.error?.stack,
                      frequencyInfo: this.state.frequencyInfo ?? undefined,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 hover:text-amber-200 transition-colors cursor-pointer"
                >
                  <Bug className="h-3.5 w-3.5" />
                  Report this error
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
