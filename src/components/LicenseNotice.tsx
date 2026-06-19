import { X } from "lucide-react";

const REPO_URL = "https://github.com/tonythethompson/Olive-Studio";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const AGPL_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

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
          <h2 id="license-notice-title" className="text-sm font-semibold text-slate-100">
            License
          </h2>
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
            <a
              href={AGPL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-electric-blue hover:underline"
            >
              GNU Affero General Public License v3.0
            </a>
            .
          </p>
          <p>
            You may use, study, modify, and redistribute this program under the terms of that license.
            Modified versions must remain under the same license.
          </p>
          <p>
            If you run a modified version as a network service, AGPL section 13 requires you to offer
            corresponding source code to users interacting with it over the network.
          </p>
          <p className="text-[11px] text-slate-500">
            Copyright © 2026 Anthony Thompson. Source:{" "}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-electric-blue hover:underline"
            >
              GitHub
            </a>
            {" · "}
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-electric-blue hover:underline"
            >
              full license text
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
