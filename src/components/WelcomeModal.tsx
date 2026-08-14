import { useState } from "react";
import { X } from "lucide-react";
import { openExternal } from "@/lib/openExternal";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";
import { Button } from "@/components/ui/Button";

const REPO_URL = "https://github.com/tonythethompson/Olive-Studio";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const dismissWelcome = usePreferencesStore((s) => s.dismissWelcome);

  if (!open) return null;

  const handleClose = () => {
    if (dontShowAgain) dismissWelcome();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded border border-slate-800 bg-slate-900 p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 id="welcome-modal-title" className="text-base font-semibold text-slate-100">
            Welcome to Olive Studio
          </h1>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-500 hover:text-slate-300 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 text-sm text-slate-400 leading-relaxed">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">What is Microsoft Olive?</h2>
            <p>
              Olive is Microsoft&apos;s open-source toolkit for optimizing machine learning models.
              It converts models to ONNX and applies optimizations like quantization, pruning, and
              graph tuning so they run faster and smaller on your hardware — CPU, GPU, or NPU.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">What you can do here</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Pick a model source and target your hardware (CPU, GPU, NPU).</li>
              <li>Build an optimization recipe step by step and validate it before running.</li>
              <li>Export the recipe as JSON or run Olive locally on your machine.</li>
              <li>Try the optimized model in the Playground.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">The Assistant</h2>
            <p>
              The built-in Assistant (open it from the sidebar) can answer questions about Olive,
              explain optimization passes, and help you build and validate recipes as you go.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Source code and issues:{" "}
            <button
              type="button"
              onClick={() => void openExternal(REPO_URL)}
              className="text-electric-blue hover:underline cursor-pointer bg-transparent border-none p-0 inline text-xs"
            >
              GitHub
            </button>
          </p>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-800 accent-electric-blue cursor-pointer"
            />
            Don&apos;t show again
          </label>
          <Button onClick={handleClose}>Get started</Button>
        </div>
      </div>
    </div>
  );
}
