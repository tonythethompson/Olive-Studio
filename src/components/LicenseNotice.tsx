import { X } from "lucide-react";
import { openExternal } from "@/lib/openExternal";

const REPO_URL = "https://github.com/tonythethompson/Olive-Studio";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const MIT_URL = "https://opensource.org/licenses/MIT";

interface LicenseNoticeProps {
  open: boolean;
  onClose: () => void;
}

export function LicenseNotice({ open, onClose }: LicenseNoticeProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-950/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="license-notice-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded border border-slate-800 bg-slate-900 p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 id="license-notice-title" className="text-sm font-semibold text-slate-100">
            License
          </h1>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 text-xs text-slate-400 leading-relaxed">
          <p>
            <span className="text-slate-200">Olive Studio</span> is free software licensed under the{" "}
            <button
              type="button"
              onClick={() => void openExternal(MIT_URL)}
              className="text-electric-blue hover:underline cursor-pointer bg-transparent border-none p-0 inline"
            >
              MIT License
            </button>
            .
          </p>
          <p>
            You may use, study, modify, and redistribute this program under the terms of that license.
            Modified versions may be relicensed under a different license at your discretion.
          </p>
          <p className="text-[11px] text-slate-500">
            Copyright © 2026 Anthony Thompson. Source:{" "}
            <button
              type="button"
              onClick={() => void openExternal(REPO_URL)}
              className="text-electric-blue hover:underline cursor-pointer bg-transparent border-none p-0 inline text-[11px]"
            >
              GitHub
            </button>
            {" · "}
            <button
              type="button"
              onClick={() => void openExternal(LICENSE_URL)}
              className="text-electric-blue hover:underline cursor-pointer bg-transparent border-none p-0 inline text-[11px]"
            >
              full license text
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
