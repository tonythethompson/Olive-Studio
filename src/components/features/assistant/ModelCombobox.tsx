import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  getModelCatalogMembership,
  modelCatalogMembershipLabel,
  type ModelCatalogSource,
} from "@/lib/modelCatalogMembership";
import { cn } from "@/lib/utils";

export interface ModelComboboxOption {
  id: string;
  label: string;
}

interface ModelComboboxProps {
  id?: string;
  value: string;
  options: ReadonlyArray<ModelComboboxOption>;
  modelsSource: ModelCatalogSource | null;
  modelsLoading?: boolean;
  placeholder?: string;
  onChange: (modelId: string) => void;
}

const MAX_VISIBLE = 40;

/**
 * Single searchable model control: filter live/fallback options and still accept freehand ids.
 * Opening the list shows the full catalog; typing then narrows it.
 */
export function ModelCombobox({
  id,
  value,
  options,
  modelsSource,
  modelsLoading = false,
  placeholder = "Search or type a model id…",
  onChange,
}: ModelComboboxProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /** null = no keyboard/mouse highlight yet; Enter must not commit a different model. */
  const [highlight, setHighlight] = useState<number | null>(null);
  /** null = not filtering (show full list); string = active search / freehand edit. */
  const [query, setQuery] = useState<string | null>(null);

  const inputValue = query ?? value;
  const filterText = query !== null ? query.trim().toLowerCase() : "";

  const filtered = useMemo(() => {
    if (!filterText) return options.slice(0, MAX_VISIBLE);
    const matches = options.filter(
      (m) => m.id.toLowerCase().includes(filterText) || m.label.toLowerCase().includes(filterText),
    );
    return matches.slice(0, MAX_VISIBLE);
  }, [options, filterText]);

  const membership = getModelCatalogMembership(value, options, modelsSource);
  const membershipLabel = modelCatalogMembershipLabel(membership);
  const safeHighlight =
    highlight === null || filtered.length === 0
      ? null
      : Math.min(highlight, filtered.length - 1);

  const closeList = () => {
    setOpen(false);
    setQuery(null);
    setHighlight(null);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        closeList();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const pick = (modelId: string) => {
    onChange(modelId);
    closeList();
  };

  const openList = () => {
    setOpen(true);
    // Keep the selected id in the field, but do not filter until the user types.
    setQuery(null);
    const selectedIndex = options.findIndex((option) => option.id === value);
    // Only auto-highlight when the current value is in the visible window.
    // Clamping to MAX_VISIBLE-1 / 0 would make focus+Enter commit a different model.
    if (selectedIndex >= 0 && selectedIndex < MAX_VISIBLE) {
      setHighlight(selectedIndex);
    } else {
      setHighlight(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight((i) => {
        if (filtered.length === 0) return null;
        if (i === null) return 0;
        return Math.min(i + 1, filtered.length - 1);
      });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight((i) => {
        if (filtered.length === 0) return null;
        if (i === null) return filtered.length - 1;
        return Math.max(i - 1, 0);
      });
      return;
    }
    if (event.key === "Enter" && open && safeHighlight !== null && filtered[safeHighlight]) {
      event.preventDefault();
      pick(filtered[safeHighlight]!.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeList();
    }
  };

  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    // Options use mousedown.preventDefault so they never steal focus; Tab leaves the root.
    if (rootRef.current?.contains(event.relatedTarget as Node)) return;
    closeList();
  };

  return (
    <div ref={rootRef} className="relative space-y-1">
      <input
        id={id}
        role="combobox"
        aria-label="AI model"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && safeHighlight !== null && filtered[safeHighlight]
            ? `${listboxId}-opt-${safeHighlight}`
            : undefined
        }
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={inputValue}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          // Do not auto-highlight the first filter match: Enter would overwrite freehand ids
          // that partially match the catalog (e.g. openai/gpt-4o-my-ft → openai/gpt-4o).
          // Arrow keys / mouse still set an explicit highlight for intentional commits.
          setHighlight(null);
          onChange(next);
          setOpen(true);
        }}
        onFocus={openList}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-electric-blue"
      />

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={filterText ? "Matching models" : "Available models"}
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">
              No catalog matches. Keep typing to use a freehand model id.
            </li>
          ) : (
            filtered.map((m, index) => {
              const active = safeHighlight !== null && index === safeHighlight;
              const selected = m.id === value;
              return (
                <li
                  key={m.id}
                  id={`${listboxId}-opt-${index}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(m.id);
                  }}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-sm",
                    active ? "bg-electric-blue/20 text-slate-100" : "text-slate-300",
                    selected && "font-medium",
                  )}
                >
                  <span className="block truncate">{m.label}</span>
                  {m.label !== m.id && (
                    <span className="block truncate text-[11px] text-slate-500">{m.id}</span>
                  )}
                </li>
              );
            })
          )}
          {!filterText && options.length > MAX_VISIBLE && (
            <li className="px-3 py-1.5 text-[11px] text-slate-500 border-t border-slate-800">
              Showing first {MAX_VISIBLE} models. Type to search the full catalog.
            </li>
          )}
          {filterText && options.length > MAX_VISIBLE && filtered.length === MAX_VISIBLE && (
            <li className="px-3 py-1.5 text-[11px] text-slate-500 border-t border-slate-800">
              Showing first {MAX_VISIBLE} matches. Type to narrow further.
            </li>
          )}
        </ul>
      )}

      {!open && !modelsLoading && membershipLabel && (
        <p className="text-[11px] leading-snug text-amber-400/90" role="status">
          {membershipLabel}
        </p>
      )}
    </div>
  );
}
