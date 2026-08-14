/**
 * Missing-system-Python CTA. Extracted so RuntimeEnvControls stays under
 * CodeFactor method-complexity limits.
 */
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";

type PythonPrerequisite = {
  downloadUrl: string;
  canAutoInstall: boolean;
  autoInstallLabel: string | null;
  command: string;
};

export function PythonMissingInstall({
  prereq,
  busy,
  onInstall,
  onCopyCommand,
}: {
  prereq: PythonPrerequisite | null | undefined;
  busy: boolean;
  onInstall: () => void;
  onCopyCommand: (command: string) => void;
}) {
  return (
    <div className="space-y-1.5 rounded border border-amber-700/40 bg-amber-950/20 p-2">
      <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
        Python 3.10–3.13 is needed for live Olive runs. 3.12 is recommended.
      </p>
      <div className="flex flex-wrap gap-1">
        <a
          href={prereq?.downloadUrl ?? "https://www.python.org/downloads/"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-slate-200 hover:border-electric-blue hover:text-electric-blue font-sans text-[11px]"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          Download Python 3.12
        </a>
        {prereq?.canAutoInstall && (
          <button
            type="button"
            disabled={busy}
            onClick={onInstall}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10 disabled:opacity-40 font-sans text-[11px]"
          >
            {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {prereq.autoInstallLabel ?? "Install Python 3.12"}
          </button>
        )}
      </div>
      {prereq?.command && (
        <div className="flex gap-1">
          <input
            readOnly
            aria-label="Python install command"
            value={prereq.command}
            className="flex-1 min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-300"
          />
          <button
            type="button"
            onClick={() => onCopyCommand(prereq.command)}
            className="shrink-0 px-2 py-1 rounded border border-slate-600 text-slate-200 hover:border-electric-blue hover:text-electric-blue font-sans text-[11px]"
            title="Copy install command"
          >
            <Copy className="h-3 w-3" aria-hidden />
            <span className="sr-only">Copy install command</span>
          </button>
        </div>
      )}
    </div>
  );
}
