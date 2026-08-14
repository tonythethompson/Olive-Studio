import { useEffect, useRef, useState, useTransition } from "react";
import { type UIState } from "@/types";
import { buildRecipeJsonFromState } from "@/lib/recipePipeline";

export type RecipeViewMode = "graph" | "json";

export interface UseRecipeViewOptions {
  state: UIState;
}

export interface UseRecipeViewReturn {
  recipeView: RecipeViewMode;
  setRecipeView: (view: RecipeViewMode) => void;
  visitedRecipeViews: Set<string>;
  moreToolsOpen: boolean;
  setMoreToolsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  moreToolsContainerRef: React.RefObject<HTMLDivElement | null>;
  moreToolsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  isExportOpen: boolean;
  setIsExportOpen: (open: boolean) => void;
  isExportCopied: boolean;
  handleExportCopy: () => void;
  handleExportDownload: () => void;
}

/**
 * Owns recipe preview view state (graph/json, lazy-mount tracking), the
 * "More" tools menu (open state + click-outside/Escape handling), and the
 * export recipe overlay state (open/copied + copy/download actions).
 */
export function useRecipeView({ state }: UseRecipeViewOptions): UseRecipeViewReturn {
  const [recipeView, setRecipeViewRaw] = useState<RecipeViewMode>("graph");
  const [visitedRecipeViews, setVisitedRecipeViews] = useState<Set<string>>(new Set(["graph"]));
  const [, startRecipeTransition] = useTransition();
  const setRecipeView = (view: RecipeViewMode) => {
    startRecipeTransition(() => {
      setRecipeViewRaw(view);
      setVisitedRecipeViews((prev) => {
        if (prev.has(view)) return prev;
        return new Set(prev).add(view);
      });
    });
  };

  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const moreToolsContainerRef = useRef<HTMLDivElement | null>(null);
  const moreToolsTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!moreToolsOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && moreToolsContainerRef.current?.contains(target)) return;
      setMoreToolsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreToolsOpen(false);
      moreToolsTriggerRef.current?.focus();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreToolsOpen]);

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExportCopied, setIsExportCopied] = useState(false);
  const exportCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (exportCopiedTimerRef.current) clearTimeout(exportCopiedTimerRef.current);
    };
  }, []);

  const handleExportCopy = () => {
    // Rebuild from live state — the displayed (deferred) recipe may lag the latest keystroke.
    void navigator.clipboard
      .writeText(buildRecipeJsonFromState(state))
      .then(() => {
        setIsExportCopied(true);
        if (exportCopiedTimerRef.current) clearTimeout(exportCopiedTimerRef.current);
        exportCopiedTimerRef.current = setTimeout(() => setIsExportCopied(false), 2000);
      })
      .catch(() => {});
  };

  const handleExportDownload = () => {
    // Rebuild from live state — the displayed (deferred) recipe may lag the latest keystroke.
    const jsonString = buildRecipeJsonFromState(state);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const modelCleanName = (state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "model")
      .replace(/[^a-z0-9_-]/gi, "_")
      .toLowerCase();
    link.href = url;
    link.download = `olive_recipe_${modelCleanName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return {
    recipeView,
    setRecipeView,
    visitedRecipeViews,
    moreToolsOpen,
    setMoreToolsOpen,
    moreToolsContainerRef,
    moreToolsTriggerRef,
    isExportOpen,
    setIsExportOpen,
    isExportCopied,
    handleExportCopy,
    handleExportDownload,
  };
}
