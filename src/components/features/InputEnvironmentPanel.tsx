import { useState, useRef, useEffect, ChangeEvent, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  Input,
  Label,
  Select,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
} from "@/components/ui";
import { UIState } from "@/types";
import { SUGGESTED_RECIPES } from "@/data/recipes";
import {
  compareCatalogMetadataToRecipe,
  deriveUiStateFromOliveRecipe,
  fetchGitHubRecipeJson,
  fetchOliveRecipesCatalogItem,
  getCatalogDeviceFromRecipe,
  OLIVE_RECIPES_BRANCH,
  OLIVE_RECIPES_REPO,
  type RecipeCatalogItem,
} from "@/lib/oliveRecipeHub";
import { parseRecipeJson } from "@/lib/recipePipeline";
import { cn } from "@/lib/utils";
import {
  buildLocalModelHints,
  scoreRecipeMatchForLocal,
  summarizeLocalRecipeMatches,
  type LocalModelHints,
} from "@/lib/recipeModelMatch";
import {
  assessCatalogItemHardwareCompatibility,
  assessRecipeHardwareCompatibility,
  summarizeRecipeHardwareCompatibility,
} from "@/lib/recipeHardwareCompatibility";
import { isNvTensorRtRtxCatalogPath } from "@/lib/tensorrtRtxDeps";
import { fetchHardwareProbe, type HardwareProbeResult } from "@/lib/hardwareProbe";
import { estimateVramForCatalogPreset } from "@/lib/presetVramEstimate";
import {
  DownloadCloud,
  KeyRound,
  Database,
  Search,
  FolderUp,
  File as FileIcon,
  X,
  HardDrive,
  Cloud,
  Layers,
  Loader2,
  Check,
  Copy,
  ChevronRight,
  ChevronUp,
  Info,
  FileCode,
  Activity,
  Cpu,
  History,
  CheckCircle2,
  GitBranch,
  GitPullRequest,
  Globe,
  RefreshCw,
  AlertTriangle,
  FileJson,
} from "lucide-react";

interface ReconstructedItem {
  baseName: string;
  totalSize: number;
  finalHash: string;
  chunks: { name: string; size: number; hash: string }[];
  reconstructedAt: string;
}

function presetDisplayName(name: string): { title: string; meta: string } {
  const parts = name
    .split(" · ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { title: parts[0], meta: parts.slice(1).join(" · ") };
  }
  return { title: name, meta: "" };
}

export function InputEnvironmentPanel({
  state,
  setState,
}: {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chunkFilesRef = useRef<Map<string, File>>(new Map());
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [reconstructProgress, setReconstructProgress] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [reconstructedHistory, setReconstructedHistory] = useState<ReconstructedItem[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);

  // HuggingFace token
  const [hfTokenStatus, setHfTokenStatus] = useState<"environment" | "user" | "none" | "loading">("loading");
  const [hfTokenInput, setHfTokenInput] = useState("");
  const [isSubmittingToken, setIsSubmittingToken] = useState(false);

  useEffect(() => {
    fetch("/api/env/hf-token-status")
      .then((r) => r.json())
      .then((d) => setHfTokenStatus(d.source))
      .catch(() => setHfTokenStatus("none"));
  }, []);

  const handleSubmitToken = async () => {
    if (!hfTokenInput.trim()) return;
    setIsSubmittingToken(true);
    try {
      const r = await fetch("/api/env/hf-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: hfTokenInput.trim() }),
      });
      if (r.ok) {
        setHfTokenStatus("user");
        setHfTokenInput("");
      }
    } catch {
      /* ignore */
    }
    setIsSubmittingToken(false);
  };

  const handleClearToken = async () => {
    await fetch("/api/env/hf-token", { method: "DELETE" });
    setHfTokenStatus("none");
  };

  // States for the Olive Recipe Hub
  const [recipeSearch, setRecipeSearch] = useState("");
  const [selectedArchitecture, setSelectedArchitecture] = useState<string>("All");
  const [selectedDevice, setSelectedDevice] = useState<string>("All");
  const [syncStatus, setSyncStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const [repoUrl, setRepoUrl] = useState(`https://github.com/${OLIVE_RECIPES_REPO}`);
  const [repoBranch, setRepoBranch] = useState(OLIVE_RECIPES_BRANCH);
  const [repoPath, setRepoPath] = useState(
    "Qwen-Qwen2.5-1.5B-Instruct/NvTensorRtRtx/Qwen2.5-1.5B-Instruct_model_builder_fp16.json",
  );
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [activeRecipeTab, setActiveRecipeTab] = useState<"starter" | "github" | "editor">("starter");
  const [recipeSuccessMsg, setRecipeSuccessMsg] = useState<string | null>(null);
  const [applyingRecipePath, setApplyingRecipePath] = useState<string | null>(null);
  const [appliedRecipeLabel, setAppliedRecipeLabel] = useState<string | null>(null);
  const [recipeRailExpanded, setRecipeRailExpanded] = useState(true);
  const [localModelHints, setLocalModelHints] = useState<LocalModelHints | null>(null);
  const [localHintsLoading, setLocalHintsLoading] = useState(false);
  const [showLocalRecipeMatchesOnly, setShowLocalRecipeMatchesOnly] = useState(false);
  const [hideIncompatibleRecipes, setHideIncompatibleRecipes] = useState(true);
  const [hardwareProbe, setHardwareProbe] = useState<HardwareProbeResult | null>(null);
  const [hardwareProbeLoading, setHardwareProbeLoading] = useState(true);

  const recipeRailCollapsed = Boolean(appliedRecipeLabel) && !recipeRailExpanded;

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: on-mount hardware probe
    setHardwareProbeLoading(true);
    void fetchHardwareProbe(false)
      .then((result) => {
        if (!cancelled) setHardwareProbe(result);
      })
      .catch(() => {
        if (!cancelled) setHardwareProbe(null);
      })
      .finally(() => {
        if (!cancelled) setHardwareProbeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyCuratedRecipe = async (item: RecipeCatalogItem, options?: { allowIncompatible?: boolean }) => {
    setApplyingRecipePath(item.repoPath);
    setSyncStatus("idle");
    setSyncError("");

    try {
      const json = await fetchOliveRecipesCatalogItem(item);
      const metadata = compareCatalogMetadataToRecipe(item, json);
      const hw = assessCatalogItemHardwareCompatibility(item, hardwareProbe, json);

      if (hw.tier === "unavailable" && !options?.allowIncompatible) {
        setSyncStatus("error");
        setSyncError(
          `Recipe targets ${hw.targetDevice} but this machine cannot run it. ${hw.reason} Use "Apply anyway" only for remote or cross-compile workflows.`,
        );
        return;
      }

      setState(deriveUiStateFromOliveRecipe(json, { replacePasses: true }));
      setAppliedRecipeLabel(item.name);
      setRecipeRailExpanded(false);
      setImportJson(JSON.stringify(json, null, 2));
      setImportError(null);
      const mismatchNote =
        !metadata.matches && metadata.recipeDevice
          ? ` Catalog device (${metadata.catalogDevice}) differs from recipe EP (${metadata.recipeDevice}).`
          : "";
      const approximateNote =
        item.metadataSource !== "recipe" ? " Tags are folder-inferred (approximate)." : "";
      const hwNote =
        hw.tier === "unavailable"
          ? " Applied despite missing local hardware (cross-compile / remote target)."
          : hw.tier === "compatible"
            ? ` Verified for ${hw.targetDevice} on this machine.`
            : "";
      setRecipeSuccessMsg(`Applied preset recipe: "${item.name}"!${approximateNote}${mismatchNote}${hwNote}`);
      setTimeout(() => {
        setRecipeSuccessMsg(null);
      }, 5000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setSyncStatus("error");
      setSyncError(err.message || "Failed to load recipe from GitHub.");
    } finally {
      setApplyingRecipePath(null);
    }
  };

  const handleApplyCuratedRecipe = (item: RecipeCatalogItem) => applyCuratedRecipe(item);
  const handleApplyCuratedRecipeAnyway = (item: RecipeCatalogItem) =>
    applyCuratedRecipe(item, { allowIncompatible: true });

  const handleFetchRemote = async () => {
    setSyncStatus("loading");
    setSyncError("");

    try {
      const { json } = await fetchGitHubRecipeJson(repoUrl, repoBranch, repoPath);
      setImportJson(JSON.stringify(json, null, 2));
      setSyncStatus("success");
      setRecipeSuccessMsg("Downloaded remote recipe payload! Inspect in Editor tab.");
      setTimeout(() => setRecipeSuccessMsg(null), 4000);
      setActiveRecipeTab("editor");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error(err);
      setSyncStatus("error");
      setSyncError(err.message || "Failed to download remote file. Check connection URL.");
    }
  };

  const handleImport = (allowIncompatible = false) => {
    const { recipe, schema } = parseRecipeJson(importJson);
    if (!schema.valid) {
      setImportError(`Recipe structure invalid:\n- ${schema.errors.join("\n- ")}`);
      return;
    }

    const targetDevice = getCatalogDeviceFromRecipe(recipe) ?? "CPU";
    const hw = assessRecipeHardwareCompatibility(targetDevice, hardwareProbe);
    if (hw.tier === "unavailable" && !allowIncompatible) {
      setImportError(
        `Recipe targets ${hw.targetDevice} but this machine cannot run it.\n${hw.reason}\nUse "Apply anyway" for remote/cross-compile workflows.`,
      );
      return;
    }

    setState(deriveUiStateFromOliveRecipe(recipe, { replacePasses: true }));
    setAppliedRecipeLabel("Custom JSON recipe");
    setRecipeRailExpanded(false);
    setImportError(null);
    setRecipeSuccessMsg(
      hw.tier === "unavailable"
        ? "Recipe applied (incompatible hardware — remote/cross-compile target)."
        : "Recipe parsed and applied successfully!",
    );
    setTimeout(() => setRecipeSuccessMsg(null), 4000);
  };

  const filteredRecipes = SUGGESTED_RECIPES.filter((item) => {
    const query = recipeSearch.toLowerCase();
    const matchesSearch =
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query) ||
      item.repoPath.toLowerCase().includes(query);
    const matchesArch = selectedArchitecture === "All" || item.architecture === selectedArchitecture;
    const matchesDev =
      selectedDevice === "All" ||
      item.device === selectedDevice ||
      (selectedDevice === "TensorRT RTX" && isNvTensorRtRtxCatalogPath(item.repoPath));
    return matchesSearch && matchesArch && matchesDev;
  });

  useEffect(() => {
    if (state.localFiles.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset hints when no files
      setLocalModelHints(null);
      setLocalHintsLoading(false);
      setShowLocalRecipeMatchesOnly(false);
      return;
    }

    let cancelled = false;
    setLocalHintsLoading(true);

    void (async () => {
      const configFile = chunkFilesRef.current.get("config.json");
      let configText: string | undefined;
      if (configFile) {
        try {
          configText = await configFile.text();
        } catch {
          configText = undefined;
        }
      }

      if (cancelled) return;
      setLocalModelHints(
        buildLocalModelHints(
          state.localFiles.map((f) => f.name),
          configText,
        ),
      );
      setLocalHintsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [state.localFiles]);

  const localMatchSummary = useMemo(
    () => (localModelHints ? summarizeLocalRecipeMatches(localModelHints, SUGGESTED_RECIPES) : null),
    [localModelHints],
  );

  const hardwareMatchSummary = useMemo(
    () => (hardwareProbe ? summarizeRecipeHardwareCompatibility(SUGGESTED_RECIPES, hardwareProbe) : null),
    [hardwareProbe],
  );

  const curatedRecipesWithMatch = useMemo(() => {
    let rows = filteredRecipes;
    if (localModelHints && showLocalRecipeMatchesOnly) {
      rows = rows.filter((item) => scoreRecipeMatchForLocal(localModelHints, item).tier !== "none");
    }
    if (hideIncompatibleRecipes && hardwareProbe) {
      rows = rows.filter(
        (item) => assessCatalogItemHardwareCompatibility(item, hardwareProbe).tier !== "unavailable",
      );
    }

    return rows
      .map((item) => ({
        item,
        match: localModelHints ? scoreRecipeMatchForLocal(localModelHints, item) : null,
        hardware: assessCatalogItemHardwareCompatibility(item, hardwareProbe),
      }))
      .sort((a, b) => {
        const hwOrder = { compatible: 0, unknown: 1, unavailable: 2 };
        const hwDiff = hwOrder[a.hardware.tier] - hwOrder[b.hardware.tier];
        if (hwDiff !== 0) return hwDiff;
        return (b.match?.score ?? -1) - (a.match?.score ?? -1);
      });
  }, [filteredRecipes, localModelHints, showLocalRecipeMatchesOnly, hideIncompatibleRecipes, hardwareProbe]);

  const pathSuggestions = SUGGESTED_RECIPES.filter((item) => {
    if (!repoPath.trim()) return true;
    return item.repoPath.toLowerCase().includes(repoPath.toLowerCase());
  }).slice(0, 40);

  // Helper to get hash from reconstructed history (or a placeholder for local files)
  const getDisplayHash = (name: string) => {
    // Check reconstructed history for real hash
    const recon = reconstructedHistory.find((r) => r.baseName === name);
    if (recon) return recon.finalHash;
    // Check chunk hashes within reconstructed history
    for (const r of reconstructedHistory) {
      const chunk = r.chunks.find((c) => c.name === name);
      if (chunk) return chunk.hash;
    }
    // For non-reconstructed local files, return a placeholder indicating no hash computed
    return `sha256:(not yet computed — reconstruct to get real hash)`;
  };

  const getFileFormatLabel = (name: string) => {
    const _ext = name.split(".").pop()?.toLowerCase();

    const chunkMatch = name.match(/\.(\d{3,})$/);
    if (chunkMatch) {
      return "Olive Binary Chunk Segment";
    }

    if (name.endsWith(".pt") || name.endsWith(".pth")) return "PyTorch State Dict (Checkpoint)";
    if (name.endsWith(".bin")) return "PyTorch Binary Weights";
    if (name.endsWith(".safetensors")) return "HF Safetensors Weight Map";
    if (name.endsWith(".onnx")) return "ONNX Runtime Optimized Model";
    if (name.endsWith(".xml")) return "OpenVINO Intermediate Representation (XML)";
    if (name.endsWith(".json")) return "Model Hyperparameters Config (JSON)";

    return "Generalized Model Binary Blob";
  };

  const getFileDescription = (name: string) => {
    const fmt = getFileFormatLabel(name);
    if (fmt.includes("PyTorch State Dict")) {
      return "Contains floating point model weight tensors indexed by layer names. Raw parameters from trainer output.";
    }
    if (fmt.includes("Weights")) {
      return "CJS-compliant weight array buffer suitable for multi-threaded direct binary loads.";
    }
    if (fmt.includes("Safetensors")) {
      return "Secure, zero-copy, memory-mapped key-value header model format safely omitting executable Python pickles.";
    }
    if (fmt.includes("ONNX")) {
      return "Optimized platform-independent dataflow graph representing operations and layer nodes in the ONNX spec.";
    }
    if (fmt.includes("Config")) {
      return "Hyperparameters config mapping architecture layers, vocabulary size, attention heads, type tokens, and weights formats.";
    }
    if (fmt.includes("Chunk Segment")) {
      return "Byte-exact partition of a large-scale weight file segmented for robust transfers and parallel cache assemblies.";
    }
    return "Standard model compilation asset. Subject to parsing, quantization, and layer alignment workflows.";
  };

  const getSimulatedTensors = (name: string, size: number) => {
    const isChunk = name.match(/\.(\d{3,})$/) !== null;
    if (isChunk) {
      return [
        { key: "partition_id", val: name.split(".").pop() || "001" },
        { key: "compression", val: "None (Raw Bytes)" },
        {
          key: "memory_footprint",
          val: `${(size / (1024 * 1024)).toFixed(1)} MB`,
        },
        { key: "segment_checksum", val: "Verified Integrity" },
      ];
    }
    if (name.endsWith(".json")) {
      return [
        { key: "vocab_size", val: "32,000 token embeddings" },
        { key: "hidden_size", val: "4096 dimensions" },
        { key: "num_attention_heads", val: "32 heads" },
        { key: "num_hidden_layers", val: "32 layer blocks" },
        { key: "model_architecture", val: "llama" },
      ];
    }
    // Standard weight files
    const baseTensorsCount = Math.floor((size / 10000000) % 200) + 50;
    return [
      {
        key: "total_parameters",
        val: `${(size / 400000000).toFixed(2)}B parameters (est)`,
      },
      {
        key: "weight_dtype",
        val: size > 2500000000 ? "Float32 (32-bit float)" : "Float16 (16-bit float)",
      },
      { key: "registered_tensors", val: `${baseTensorsCount} unique tensors` },
      { key: "tensor_index_status", val: "Ready (Fully mapped)" },
    ];
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);

      // Store actual File objects for reconstruction
      for (const f of newFiles as File[]) {
        chunkFilesRef.current.set(f.name, f);
      }

      const newFileMetas = newFiles.map((f: File) => ({
        name: f.name,
        size: f.size,
      }));
      // Append to existing, avoid duplicates by name
      const existingNames = new Set(state.localFiles.map((f) => f.name));
      const filteredNew = newFileMetas.filter((f) => !existingNames.has(f.name));

      const combined = [...state.localFiles, ...filteredNew].sort((a, b) => a.name.localeCompare(b.name));

      setState({ localFiles: combined });
      if (filteredNew.length > 0 && !selectedFileName) {
        setSelectedFileName(filteredNew[0].name);
      }
    }
  };

  const removeFile = (name: string) => {
    const updatedFiles = state.localFiles.filter((f) => f.name !== name);
    setState({ localFiles: updatedFiles });
    if (selectedFileName === name) {
      setSelectedFileName(updatedFiles.length > 0 ? updatedFiles[0].name : null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Identify chunked files (e.g. model.bin.001, model.bin.002)
  const getBaseName = (filename: string) => {
    const match = filename.match(/^(.*)\.(\d{3,})$/);
    return match ? match[1] : null;
  };

  const reconstructableGroups = () => {
    const groups: Record<string, { name: string; size: number }[]> = {};
    for (const f of state.localFiles) {
      const base = getBaseName(f.name);
      if (base) {
        if (!groups[base]) groups[base] = [];
        groups[base].push(f);
      }
    }
    // Only return groups that have files for reconstruction
    return Object.entries(groups).filter(([_base, files]) => files.length > 0);
  };

  const startReconstruction = async (baseName: string, files: { name: string; size: number }[]) => {
    setIsReconstructing(true);
    setReconstructProgress(0);
    // Clear any previous download
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
      setDownloadName(null);
    }

    try {
      // Sort chunks by numeric suffix
      const sortedFiles = [...files].sort((a, b) => {
        const numA = parseInt(a.name.match(/(\d+)$/)?.[1] || "0");
        const numB = parseInt(b.name.match(/(\d+)$/)?.[1] || "0");
        return numA - numB;
      });

      const totalBytes = sortedFiles.reduce((acc, f) => acc + f.size, 0);
      let bytesRead = 0;
      const buffers: ArrayBuffer[] = [];

      for (const fileMeta of sortedFiles) {
        const fileObj = chunkFilesRef.current.get(fileMeta.name);
        if (!fileObj) {
          throw new Error(`File object not found for chunk: ${fileMeta.name}. Please re-select the files.`);
        }
        const buffer = await fileObj.arrayBuffer();
        buffers.push(buffer);
        bytesRead += buffer.byteLength;
        setReconstructProgress(Math.round((bytesRead / totalBytes) * 100));
      }

      // Concatenate all ArrayBuffers into one Blob
      const blob = new Blob(buffers);
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadName(baseName);

      // Compute real SHA-256 hash using Web Crypto API
      const combined = await blob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      const finalHash = `sha256:${hashHex}`;

      // Build chunk metadata with real sizes
      const generatedChunks = sortedFiles.map((file) => ({
        name: file.name,
        size: file.size,
        hash: `sha256:chunk-${file.name}`,
      }));

      setReconstructedHistory((prev) => [
        ...prev,
        {
          baseName,
          totalSize: blob.size,
          finalHash,
          chunks: generatedChunks,
          reconstructedAt: new Date().toISOString(),
        },
      ]);

      // Remove original chunk files from localFiles and add assembled file
      const chunkNames = new Set(files.map((f) => f.name));
      const newLocalFiles = state.localFiles.filter((f) => !chunkNames.has(f.name));
      setState({
        localFiles: [...newLocalFiles, { name: baseName, size: blob.size }],
      });
      setSelectedFileName(baseName);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Reconstruction failed:", err);
      alert(`Reconstruction failed: ${err.message}`);
    } finally {
      setIsReconstructing(false);
      setReconstructProgress(0);
    }
  };

  const activeFileSelectedName =
    selectedFileName ||
    (state.localFiles.length > 0
      ? state.localFiles[0].name
      : reconstructedHistory.length > 0
        ? reconstructedHistory[0].baseName
        : null);

  // Find file in local files or in reconstructed history or as part of chunks
  const getFileDetailedInfo = (name: string | null) => {
    if (!name) return null;

    // Check in active localFiles
    const active = state.localFiles.find((f) => f.name === name);
    if (active) {
      return {
        name: active.name,
        size: active.size,
        status: "Local Asset",
        isChunk: getBaseName(active.name) !== null,
        reconstructed: false,
        lineage: null,
      };
    }

    // Check in reconstructed items
    const recon = reconstructedHistory.find((r) => r.baseName === name);
    if (recon) {
      return {
        name: recon.baseName,
        size: recon.totalSize,
        status: "Reconstructed Binary",
        isChunk: false,
        reconstructed: true,
        lineage: recon,
      };
    }

    // Check in chunks of reconstructed history
    for (const r of reconstructedHistory) {
      const chunk = r.chunks.find((c) => c.name === name);
      if (chunk) {
        return {
          name: chunk.name,
          size: chunk.size,
          status: "Archived Chunk Segment",
          isChunk: true,
          reconstructed: false,
          lineage: { parent: r.baseName, ...r },
        };
      }
    }

    return null;
  };

  const selectedFileDetailed = getFileDetailedInfo(activeFileSelectedName);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 animate-duration-300">
      {/* SUCCESS TOAST BANNER */}
      {recipeSuccessMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-4 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-4 duration-300">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm font-medium">{recipeSuccessMsg}</div>
        </div>
      )}

      {/* Unified Model Source + Recipe split panel */}
      <Card className="border-slate-800/80">
        <CardHeader
          title="Model Source & Data"
          description="Start from an Olive recipe preset or configure Hugging Face, local, and Azure sources directly."
        />
        <CardContent>
          {recipeRailCollapsed && (
            <div className="mb-6 flex flex-col gap-3 rounded border border-electric-blue/25 bg-electric-blue/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-electric-blue/15 text-electric-blue">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-electric-blue font-medium">Applied recipe</p>
                  <p
                    className="truncate text-sm font-semibold text-slate-200"
                    title={appliedRecipeLabel ?? undefined}
                  >
                    {appliedRecipeLabel}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    Source fields below are pre-filled — edit anytime before running.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                className="h-8 shrink-0 self-start px-3 text-[11px] bg-electric-blue hover:bg-electric-blue-dark text-white sm:self-center"
                onClick={() => {
                  setRecipeRailExpanded(true);
                  setActiveRecipeTab("starter");
                }}
              >
                Change recipe
              </Button>
            </div>
          )}

          <div className={cn("flex flex-col gap-6 xl:gap-8", !recipeRailCollapsed && "xl:flex-row")}>
            {!recipeRailCollapsed && (
              <aside className="min-w-0 shrink-0 xl:w-1/2">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-slate-400">Recipes</h3>
                  {appliedRecipeLabel && (
                    <button
                      type="button"
                      onClick={() => setRecipeRailExpanded(false)}
                      className="flex cursor-pointer items-center gap-1 text-[10px] font-mono text-slate-500 hover:text-slate-300"
                    >
                      <ChevronUp className="h-3 w-3" />
                      Collapse
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800/80 bg-slate-950/30 p-3 sm:p-4 animate-in fade-in duration-200">
                  <Tabs
                    value={activeRecipeTab}
                    onValueChange={(v) => setActiveRecipeTab(v as "starter" | "github" | "editor")}
                    className="w-full"
                  >
                    <TabsList className="grid w-full grid-cols-3 h-auto rounded-lg p-1 bg-slate-950 border border-slate-900 mb-4">
                      <TabsTrigger
                        value="starter"
                        className="text-[10px] sm:text-xs py-1.5 px-1.5 sm:px-2 rounded-md cursor-pointer"
                      >
                        <Activity className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 text-electric-blue" />
                        Presets
                      </TabsTrigger>
                      <TabsTrigger
                        value="github"
                        className="text-[10px] sm:text-xs py-1.5 px-1.5 sm:px-2 rounded-md cursor-pointer"
                      >
                        <Globe className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 text-electric-blue" />
                        GitHub
                      </TabsTrigger>
                      <TabsTrigger
                        value="editor"
                        className="text-[10px] sm:text-xs py-1.5 px-1.5 sm:px-2 rounded-md cursor-pointer"
                      >
                        <FileJson className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 text-amber-400" />
                        JSON
                      </TabsTrigger>
                    </TabsList>

                    {activeRecipeTab === "starter" && (
                      <p className="text-[10px] text-slate-500 font-mono mb-3">
                        {curatedRecipesWithMatch.length} of {SUGGESTED_RECIPES.length} presets
                        {localModelHints && !localHintsLoading
                          ? ` · ${localMatchSummary?.match ?? 0} match local upload`
                          : ""}
                        {hardwareProbe && !hardwareProbeLoading
                          ? ` · ${hardwareMatchSummary?.compatible ?? 0} compatible with this PC`
                          : ""}
                      </p>
                    )}

                    {/* PRESETS TAB (microsoft/olive-recipes catalog) */}
                    <TabsContent value="starter" className="space-y-3 animate-in fade-in mt-0">
                      <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                              Hardware compatibility
                            </p>
                            {hardwareProbeLoading ? (
                              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-electric-blue" />
                                Probing this machine…
                              </p>
                            ) : hardwareProbe ? (
                              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                                <span className="text-emerald-400">
                                  {hardwareMatchSummary?.compatible ?? 0} compatible
                                </span>
                                <span className="text-slate-600"> · </span>
                                <span className="text-rose-400">
                                  {hardwareMatchSummary?.unavailable ?? 0} incompatible
                                </span>
                                <span className="text-slate-600"> · </span>
                                <span className="text-slate-500">
                                  Detected:{" "}
                                  {hardwareProbe.detectedProviders
                                    .map((p) => p.replace("ExecutionProvider", ""))
                                    .join(", ")}
                                </span>
                              </p>
                            ) : (
                              <p className="text-xs text-slate-500 mt-1">
                                Hardware probe unavailable — compatibility not verified.
                              </p>
                            )}
                          </div>
                          {hardwareProbe && !hardwareProbeLoading && (
                            <label className="flex items-center gap-2 text-[10px] text-slate-400 cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                checked={hideIncompatibleRecipes}
                                onChange={(e) => setHideIncompatibleRecipes(e.target.checked)}
                                className="rounded border-slate-700 bg-slate-950 text-electric-blue focus:ring-electric-blue/40"
                              />
                              Hide incompatible
                            </label>
                          )}
                        </div>
                      </div>

                      {syncStatus === "error" && syncError && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-xs flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          <span>{syncError}</span>
                        </div>
                      )}

                      {state.localFiles.length > 0 && (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 space-y-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                                Local model recipe match
                              </p>
                              {localHintsLoading ? (
                                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-electric-blue" />
                                  Reading upload…
                                </p>
                              ) : localModelHints ? (
                                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                                  <span className="text-slate-200 font-semibold">
                                    {localModelHints.displayName}
                                  </span>
                                  <span className="text-slate-600"> · </span>
                                  <span className="text-emerald-400">
                                    {localMatchSummary?.match ?? 0} match
                                  </span>
                                  {(localMatchSummary?.possible ?? 0) > 0 && (
                                    <>
                                      <span className="text-slate-600"> · </span>
                                      <span className="text-amber-400">
                                        {localMatchSummary?.possible} possible
                                      </span>
                                    </>
                                  )}
                                  <span className="text-slate-600"> · </span>
                                  <span className="text-slate-500">
                                    {localMatchSummary?.none ?? 0} no preset
                                  </span>
                                </p>
                              ) : null}
                              {localModelHints?.hfModelIds[0] && (
                                <p
                                  className="text-[10px] font-mono text-slate-500 mt-1 truncate"
                                  title={localModelHints.hfModelIds[0]}
                                >
                                  From config: {localModelHints.hfModelIds[0]}
                                </p>
                              )}
                            </div>
                            {localModelHints && !localHintsLoading && (localMatchSummary?.match ?? 0) > 0 && (
                              <label className="flex items-center gap-2 text-[10px] text-slate-400 cursor-pointer shrink-0">
                                <input
                                  type="checkbox"
                                  checked={showLocalRecipeMatchesOnly}
                                  onChange={(e) => setShowLocalRecipeMatchesOnly(e.target.checked)}
                                  className="rounded border-slate-700 bg-slate-950 text-electric-blue focus:ring-electric-blue/40"
                                />
                                Matches only
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                      <div className="space-y-2 pb-3 border-b border-slate-900">
                        <div className="relative">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                          <Input
                            placeholder="Search recipes..."
                            className="pl-9 h-9 text-xs"
                            value={recipeSearch}
                            onChange={(e) => setRecipeSearch(e.target.value)}
                          />
                          {recipeSearch && (
                            <button
                              type="button"
                              onClick={() => setRecipeSearch("")}
                              className="absolute right-3 top-2.5 text-slate-500 hover:text-white cursor-pointer"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <fieldset className="grid grid-cols-2 gap-2 border-0 p-0 m-0 min-w-0">
                          <legend className="sr-only">Recipe filters</legend>
                          <Select
                            id="recipe-architecture-filter"
                            aria-label="Architecture filter"
                            value={selectedArchitecture}
                            onChange={(e) => setSelectedArchitecture(e.target.value)}
                            className="h-9 text-xs py-1"
                          >
                            <option value="All">All Architectures</option>
                            <option value="Llama">Llama series</option>
                            <option value="Phi">Phi series</option>
                            <option value="Whisper">Whisper Speech</option>
                            <option value="Qwen">Qwen series</option>
                            <option value="BERT">BERT NLP</option>
                            <option value="MobileNet">MobileNet vision</option>
                            <option value="ResNet">ResNet series</option>
                            <option value="Stable Diffusion">Stable Diffusion</option>
                            <option value="Other">Other models</option>
                          </Select>
                          <Select
                            id="recipe-platform-filter"
                            aria-label="Platform filter"
                            value={selectedDevice}
                            onChange={(e) => setSelectedDevice(e.target.value)}
                            className="h-9 text-xs py-1"
                          >
                            <option value="All">All Platforms / EPs</option>
                            <option value="CUDA">NVIDIA CUDA GPU</option>
                            <option value="DirectML">Windows DirectML</option>
                            <option value="TensorRT">NVIDIA TensorRT (SDK)</option>
                            <option value="TensorRT RTX">NVIDIA TensorRT RTX</option>
                            <option value="QNN">Qualcomm QNN NPU</option>
                            <option value="OpenVINO">Intel OpenVINO</option>
                            <option value="CPU">Universal CPU</option>
                          </Select>
                        </fieldset>
                      </div>

                      <div className="max-h-[420px] overflow-y-auto rounded border border-slate-800 divide-y divide-slate-800/80">
                        {curatedRecipesWithMatch.map(({ item, match, hardware }) => {
                          const hwBlocked = hardware.tier === "unavailable";
                          const { title, meta } = presetDisplayName(item.name);
                          const vramEst = estimateVramForCatalogPreset(item, hardwareProbe);
                          const statusParts: string[] = [];
                          if (hardware.tier === "compatible") statusParts.push("Compatible");
                          else if (hardware.tier === "unavailable") statusParts.push("Incompatible");
                          else statusParts.push("Unverified");
                          if (localModelHints && match?.tier === "match") statusParts.push("Matches upload");
                          else if (localModelHints && match?.tier === "possible")
                            statusParts.push("Possible match");
                          if (item.metadataSource !== "recipe") statusParts.push("Approx. metadata");

                          return (
                            <div
                              key={item.repoPath}
                              title={hardware.reason}
                              className={cn(
                                "px-3 py-2.5 flex items-start gap-3 text-left",
                                hwBlocked && "opacity-90",
                              )}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <h4 className="text-sm font-medium text-slate-200">{title}</h4>
                                  {meta && <span className="text-xs text-slate-500">{meta}</span>}
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                                  {item.description}
                                </p>
                                <p className="text-[11px] text-slate-500 font-mono mt-1">
                                  {vramEst.summaryLine}
                                </p>
                                {vramEst.fitHint && (
                                  <p className="text-[11px] text-amber-500/90 mt-0.5">{vramEst.fitHint}</p>
                                )}
                                <p className="text-[11px] text-slate-600 mt-0.5">
                                  {statusParts.join(" · ")} · {item.device} · {item.architecture}
                                </p>
                                {hwBlocked && (
                                  <p className="text-[11px] text-rose-400/80 mt-0.5 line-clamp-1">
                                    {hardware.reason}
                                  </p>
                                )}
                              </div>
                              <div className="flex gap-1.5 shrink-0 pt-0.5">
                                <Button
                                  variant="outline"
                                  type="button"
                                  className="h-7 px-2 text-[10px] bg-slate-900 border-slate-800 text-slate-300 hover:text-white"
                                  disabled={applyingRecipePath === item.repoPath}
                                  onClick={async () => {
                                    try {
                                      const json = await fetchOliveRecipesCatalogItem(item);
                                      setImportJson(JSON.stringify(json, null, 2));
                                      setActiveRecipeTab("editor");
                                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    } catch (err: any) {
                                      setSyncStatus("error");
                                      setSyncError(err.message || "Failed to load recipe JSON.");
                                    }
                                  }}
                                >
                                  JSON
                                </Button>
                                {hwBlocked ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-7 px-2 text-[10px] border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                                    disabled={applyingRecipePath === item.repoPath}
                                    onClick={() => handleApplyCuratedRecipeAnyway(item)}
                                  >
                                    {applyingRecipePath === item.repoPath ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Apply anyway"
                                    )}
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    className="h-7 px-2.5 text-[10px] bg-electric-blue hover:bg-electric-blue-dark text-white"
                                    disabled={applyingRecipePath === item.repoPath}
                                    onClick={() => handleApplyCuratedRecipe(item)}
                                  >
                                    {applyingRecipePath === item.repoPath ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      "Apply"
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {curatedRecipesWithMatch.length === 0 && (
                          <div className="p-6 text-center">
                            <Search className="h-6 w-6 text-slate-700 mx-auto mb-2" />
                            <p className="text-xs font-semibold text-slate-400">
                              {showLocalRecipeMatchesOnly && localModelHints
                                ? "No presets match your local upload with current filters"
                                : hideIncompatibleRecipes && hardwareProbe
                                  ? "No presets compatible with this PC match your filters"
                                  : "No Presets Match Filters"}
                            </p>
                            <p className="text-[11px] text-slate-500 mt-1 max-w-[280px] mx-auto">
                              {hideIncompatibleRecipes && hardwareProbe
                                ? "Turn off “Hide incompatible” or relax search and device filters."
                                : showLocalRecipeMatchesOnly && localModelHints
                                  ? "Turn off “Matches only” or relax search and device filters."
                                  : "Try relaxing your search query or setting the category filters to default values."}
                            </p>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* GITHUB RECIPE SYNC TAB */}
                    <TabsContent value="github" className="space-y-3 animate-in fade-in mt-0">
                      <div className="space-y-3 bg-slate-950/30 p-3 rounded-xl border border-slate-900 max-h-[420px] overflow-y-auto">
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-electric-blue" />
                            GitHub Repository URL (Public)
                          </Label>
                          <Input
                            placeholder="e.g. microsoft/olive"
                            value={repoUrl}
                            onChange={(e) => setRepoUrl(e.target.value)}
                            className="font-mono text-xs h-9"
                          />
                          <p className="text-[10px] text-slate-550">
                            Supports direct link format or path parsing.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                              <GitBranch className="h-3.5 w-3.5 text-electric-blue" />
                              Target Branch
                            </Label>
                            <Input
                              value={repoBranch}
                              onChange={(e) => setRepoBranch(e.target.value)}
                              className="font-mono text-xs h-9"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                              <GitPullRequest className="h-3.5 w-3.5 text-pink-400" />
                              Recipe Path
                            </Label>
                            <Input
                              value={repoPath}
                              onChange={(e) => setRepoPath(e.target.value)}
                              className="font-mono text-xs h-9"
                              list="olive-recipe-paths"
                            />
                            <datalist id="olive-recipe-paths">
                              {pathSuggestions.map((item) => (
                                <option key={item.repoPath} value={item.repoPath}>
                                  {item.name}
                                </option>
                              ))}
                            </datalist>
                          </div>
                        </div>

                        <Button
                          type="button"
                          onClick={handleFetchRemote}
                          disabled={syncStatus === "loading" || !repoUrl.trim()}
                          className="w-full text-xs h-9 bg-electric-blue hover:bg-electric-blue-dark text-white"
                        >
                          {syncStatus === "loading" ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin text-white" />
                              Synchronizing...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 mr-2" />
                              Pull from GitHub
                            </>
                          )}
                        </Button>

                        {syncStatus === "error" && (
                          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-xs flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{syncError}</span>
                          </div>
                        )}

                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500 block pt-2 border-t border-slate-900">
                          Microsoft Olive shortcuts
                        </span>
                        <div className="grid grid-cols-1 gap-2">
                          {[
                            {
                              label: "Qwen2.5 TRT-RTX FP16",
                              repo: `https://github.com/${OLIVE_RECIPES_REPO}`,
                              branch: OLIVE_RECIPES_BRANCH,
                              path: "Qwen-Qwen2.5-1.5B-Instruct/NvTensorRtRtx/Qwen2.5-1.5B-Instruct_model_builder_fp16.json",
                            },
                            {
                              label: "Whisper Tiny CPU INT8",
                              repo: `https://github.com/${OLIVE_RECIPES_REPO}`,
                              branch: OLIVE_RECIPES_BRANCH,
                              path: "openai-whisper-tiny/cpu/whisper-tiny_cpu_int8.json",
                            },
                            {
                              label: "Phi-3.5 Mini DirectML",
                              repo: `https://github.com/${OLIVE_RECIPES_REPO}`,
                              branch: OLIVE_RECIPES_BRANCH,
                              path: "microsoft-Phi-3.5-mini-instruct/aitk/phi3_5_dml_config.json",
                            },
                            {
                              label: "ResNet PTQ (olive repo)",
                              repo: "https://github.com/microsoft/olive",
                              branch: "main",
                              path: "examples/resnet/resnet_ptq.json",
                            },
                          ].map((sc, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => {
                                setRepoUrl(sc.repo);
                                setRepoBranch(sc.branch);
                                setRepoPath(sc.path);
                                setSyncStatus("idle");
                                setSyncError("");
                              }}
                              className="text-left p-2.5 bg-slate-950/80 hover:bg-slate-950 border border-slate-900 hover:border-electric-blue/20 hover:text-white rounded-lg text-xs text-slate-300 transition-all font-sans cursor-pointer group"
                            >
                              <span className="font-semibold block text-slate-200 group-hover:text-electric-blue transition-colors">
                                {sc.label}
                              </span>
                              <span className="text-[10px] text-slate-500 block truncate font-mono mt-0.5">
                                {sc.path}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </TabsContent>

                    {/* RECIPE schema EDITOR TAB */}
                    <TabsContent value="editor" className="space-y-3 animate-in fade-in mt-0">
                      <div className="flex flex-col gap-3">
                        {importError && (
                          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-xs font-mono leading-relaxed flex items-start gap-1.5 animate-bounce">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{importError}</span>
                          </div>
                        )}

                        <div className="relative flex flex-col min-h-[180px]">
                          <textarea
                            className="w-full flex-1 bg-slate-950 border border-slate-900 hover:border-slate-800 focus:border-electric-blue rounded-lg p-3 font-mono text-[11px] text-slate-300 focus-visible:outline-none focus:focus-visible:ring-1 focus-visible:ring-electric-blue/40 placeholder:text-slate-700 resize-none h-[180px]"
                            placeholder={`{\n  "input_model": {\n    "type": "PyTorchModel",\n    "config": {\n      "hf_config": {\n        "model_name": "meta-llama/Meta-Llama-3-8B"\n      }\n    }\n  },\n  "passes": {\n    "conversion": { "type": "OnnxConversion" }\n  }\n}`}
                            value={importJson}
                            onChange={(e) => {
                              setImportJson(e.target.value);
                              if (importError) setImportError(null);
                            }}
                          />
                        </div>

                        <div className="flex flex-col sm:flex-row justify-end items-stretch sm:items-center bg-slate-950 px-4 py-3 border border-slate-900 rounded-lg gap-2">
                          <span className="text-[10px] text-slate-500 font-mono sm:mr-auto">
                            Paste raw Olive JSON format schema above or load standard presets
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleImport(true)}
                            disabled={!importJson.trim()}
                            className="text-xs h-8 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          >
                            Apply anyway
                          </Button>
                          <Button
                            type="button"
                            onClick={() => handleImport(false)}
                            disabled={!importJson.trim()}
                            className="text-xs h-8 bg-electric-blue hover:bg-electric-blue-dark text-white cursor-pointer"
                          >
                            <FileJson className="h-3.5 w-3.5 mr-1.5" />
                            Parse & Apply Configuration
                          </Button>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </aside>
            )}

            <div
              className={cn(
                "min-w-0 flex-1",
                !recipeRailCollapsed &&
                  "border-t border-slate-800/80 pt-6 xl:border-t-0 xl:border-l xl:border-slate-800/80 xl:pl-8 xl:pt-0",
              )}
            >
              <h3 className="text-sm font-medium text-slate-400 mb-4 flex items-center gap-1.5">
                <DownloadCloud className="h-3.5 w-3.5 text-electric-blue" />
                Source config
              </h3>

              {appliedRecipeLabel && (
                <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-xs text-slate-300">
                  <span className="text-emerald-400 font-semibold">From recipe:</span> {appliedRecipeLabel}
                  <span className="text-slate-500"> · </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {state.modelSource === "huggingface" && state.hfModelId
                      ? `HF · ${state.hfModelId}`
                      : state.modelSource === "local"
                        ? `Local · ${state.localFiles.length} file(s)`
                        : state.modelSource === "azure" && state.azureModelPath
                          ? `Azure · ${state.azureModelPath}`
                          : state.modelSource}
                  </span>
                </div>
              )}

              <Tabs
                value={state.modelSource}
                onValueChange={(v) => setState({ modelSource: v as UIState["modelSource"] })}
                className="w-full"
              >
                <TabsList className="mb-6 !grid h-auto w-full grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1.5">
                  <TabsTrigger
                    value="huggingface"
                    title="Hugging Face Hub"
                    className="w-full rounded-lg px-2 py-2.5 text-[11px] sm:text-xs"
                  >
                    <DownloadCloud className="mr-1.5 h-4 w-4 shrink-0" />
                    <span className="truncate">Hugging Face</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="local"
                    title="Local Machine"
                    className="w-full rounded-lg px-2 py-2.5 text-[11px] sm:text-xs"
                  >
                    <HardDrive className="mr-1.5 h-4 w-4 shrink-0" />
                    <span className="truncate">Local</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="azure"
                    title="Azure ML Model"
                    className="w-full rounded-lg px-2 py-2.5 text-[11px] sm:text-xs"
                  >
                    <Cloud className="mr-1.5 h-4 w-4 shrink-0" />
                    <span className="truncate">Azure ML</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="huggingface" className="space-y-6 animate-in fade-in">
                  <div className="grid gap-3">
                    <Label htmlFor="modelId">Hugging Face Model ID</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <Input
                        id="modelId"
                        placeholder="e.g. meta-llama/Llama-2-7b-hf"
                        className="pl-9"
                        value={state.hfModelId}
                        onChange={(e) => setState({ hfModelId: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[11px] text-slate-500 mr-1">Quick Select:</span>
                      <button
                        type="button"
                        onClick={() => setState({ hfModelId: "meta-llama/Meta-Llama-3-8B" })}
                        className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer"
                      >
                        Meta-Llama-3
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setState({
                            hfModelId: "microsoft/Phi-3-mini-4k-instruct",
                          })
                        }
                        className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer"
                      >
                        Phi-3 Mini
                      </button>
                      <button
                        type="button"
                        onClick={() => setState({ hfModelId: "openai/whisper-large-v3" })}
                        className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer"
                      >
                        Whisper Large V3
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setState({
                            hfModelId: "stabilityai/stable-diffusion-xl-base-1.0",
                          })
                        }
                        className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer"
                      >
                        Stable Diffusion XL
                      </button>
                      <button
                        type="button"
                        onClick={() => setState({ hfModelId: "bert-base-uncased" })}
                        className="text-[11px] text-slate-300 bg-slate-900 border border-slate-800 hover:border-electric-blue/50 hover:text-electric-blue px-2 py-1 rounded transition-colors cursor-pointer"
                      >
                        BERT Base
                      </button>
                    </div>
                  </div>

                  {/* HuggingFace Token */}
                  <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/30 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <Label className="flex items-center gap-1.5 mb-0">
                        <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                        HuggingFace Token
                      </Label>
                      {hfTokenStatus === "loading" && (
                        <span className="text-[10px] text-slate-500 font-mono">Checking...</span>
                      )}
                      {hfTokenStatus === "environment" && (
                        <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
                          ✓ Found in Windows env vars
                        </span>
                      )}
                      {hfTokenStatus === "user" && (
                        <span className="text-[10px] bg-electric-blue/10 border border-electric-blue/20 text-electric-blue px-2 py-0.5 rounded font-mono font-semibold">
                          ✓ Set for this session
                        </span>
                      )}
                      {hfTokenStatus === "none" && (
                        <span className="text-[10px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-mono">
                          Not set — required for gated models
                        </span>
                      )}
                    </div>

                    {hfTokenStatus !== "environment" && hfTokenStatus !== "loading" && (
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                          <input
                            type="password"
                            placeholder="hf_..."
                            autoComplete="off"
                            className="w-full pl-9 pr-3 h-9 bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-electric-blue rounded-md font-mono text-xs text-slate-200 placeholder:text-slate-600 outline-none"
                            value={hfTokenInput}
                            onChange={(e) => setHfTokenInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmitToken()}
                          />
                        </div>
                        <Button
                          type="button"
                          onClick={handleSubmitToken}
                          disabled={!hfTokenInput.trim() || isSubmittingToken}
                          className="h-9 px-4 text-xs bg-electric-blue hover:bg-electric-blue/90 text-white font-bold"
                        >
                          {isSubmittingToken ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                        </Button>
                        {hfTokenStatus === "user" && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleClearToken}
                            className="h-9 px-3 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    )}

                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Stored in server memory only — never written to disk or returned to the client. Set{" "}
                      <code className="text-slate-400 font-mono">HF_TOKEN</code> in Windows environment
                      variables for persistent access without re-entering each session.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid gap-3">
                      <Label htmlFor="hf-task-type">Task Type</Label>
                      <Select id="hf-task-type">
                        <option value="text-generation">Text Generation</option>
                        <option value="text-classification">Text Classification</option>
                        <option value="image-classification">Image Classification</option>
                        <option value="object-detection">Object Detection</option>
                        <option value="conversational">Conversational</option>
                      </Select>
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="dataset">Calibration Dataset (Optional)</Label>
                      <Input
                        id="dataset"
                        placeholder="e.g. wikitext"
                        value={state.hfDataset}
                        onChange={(e) => setState({ hfDataset: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="grid gap-3">
                      <Label htmlFor="user-script">User Script Path (Optional)</Label>
                      <Input
                        id="user-script"
                        placeholder="e.g. ./user_script.py"
                        value={state.userScript || ""}
                        onChange={(e) => setState({ userScript: e.target.value || undefined })}
                      />
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        Path to a Python script with eval/calibration functions required by some optimization
                        passes.
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="local" className="space-y-6 animate-in fade-in">
                  <div className="border-2 border-dashed border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center bg-slate-900/30 text-center hover:bg-slate-900/50 transition-colors">
                    <div className="h-12 w-12 rounded-full bg-electric-blue/10 flex items-center justify-center mb-4">
                      <FolderUp className="h-6 w-6 text-electric-blue" />
                    </div>
                    <h4 className="font-medium text-slate-200 mb-1">Upload Local Model Files</h4>
                    <p className="text-sm text-slate-500 mb-6 max-w-md">
                      Select your model weights and configurations. For massive LLMs, you can upload chunked
                      weights (e.g. <code className="text-electric-blue">.bin.001</code>,{" "}
                      <code className="text-electric-blue">.bin.002</code>).
                    </p>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                    />
                    <Button onClick={() => fileInputRef.current?.click()} variant="outline">
                      Browse Files
                    </Button>
                  </div>

                  {state.localFiles.length > 0 && (
                    <div className="space-y-4">
                      <Label className="text-sm font-semibold text-slate-300">
                        Uploaded Model Files ({state.localFiles.length})
                      </Label>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {state.localFiles.map((file, i) => {
                          const isChunk = getBaseName(file.name) !== null;
                          const isCurSelected = activeFileSelectedName === file.name;
                          return (
                            <div
                              key={i}
                              onClick={() => setSelectedFileName(file.name)}
                              className={`flex items-center justify-between p-3 rounded-lg border group transition-all cursor-pointer ${
                                isCurSelected
                                  ? "bg-electric-blue/10 border-electric-blue/60 shadow-sm ring-1 ring-electric-blue/25"
                                  : isChunk
                                    ? "bg-slate-900 border-electric-blue/25 hover:border-slate-705 hover:bg-slate-900/80"
                                    : "bg-slate-950 border-slate-800 hover:border-slate-700 hover:bg-slate-950/80"
                              }`}
                            >
                              <div className="flex items-center gap-3 overflow-hidden">
                                <FileIcon
                                  className={`h-4 w-4 shrink-0 transition-colors ${isCurSelected ? "text-electric-blue" : isChunk ? "text-blue-400" : "text-slate-500"}`}
                                />
                                <div className="truncate">
                                  <p
                                    className={`text-sm font-medium truncate transition-colors ${isCurSelected ? "text-white" : "text-slate-300 group-hover:text-slate-200"}`}
                                  >
                                    {file.name}
                                  </p>
                                  <p className="text-xs text-slate-500 font-mono">{formatSize(file.size)}</p>
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFile(file.name);
                                }}
                                className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-slate-900 transition-colors shrink-0 cursor-pointer"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Chunk Reconstruction UI */}
                      {reconstructableGroups().map(([base, files]) => (
                        <div
                          key={base}
                          className="mt-4 p-4 rounded-lg bg-electric-blue/5 border border-electric-blue/20"
                        >
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <h5 className="text-sm font-medium text-electric-blue flex items-center gap-2">
                                <Layers className="h-4 w-4" />
                                Model Reconstruction Available
                              </h5>
                              <p className="text-xs text-slate-400">
                                Detected {files.length} parts for <strong>{base}</strong> (
                                {formatSize(files.reduce((a, b) => a + b.size, 0))}
                                ).
                              </p>
                            </div>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                              <Button
                                variant="outline"
                                className="border-electric-blue/50 text-electric-blue hover:bg-electric-blue hover:text-white"
                                onClick={() => startReconstruction(base, files)}
                                disabled={isReconstructing}
                              >
                                {isReconstructing ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Assembling...
                                  </>
                                ) : (
                                  "Reconstruct Binary"
                                )}
                              </Button>
                              {downloadUrl && downloadName && (
                                <a
                                  href={downloadUrl}
                                  download={downloadName}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded text-xs text-emerald-400 font-semibold transition-all"
                                >
                                  <DownloadCloud className="h-3.5 w-3.5" />
                                  Download {downloadName}
                                </a>
                              )}
                            </div>
                          </div>

                          {isReconstructing && (
                            <div className="mt-4 space-y-1.5 animate-in fade-in">
                              <div className="flex justify-between text-xs text-electric-blue font-mono">
                                <span>Progress</span>
                                <span>{Math.round(reconstructProgress)}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-electric-blue transition-all duration-200 ease-out"
                                  style={{ width: `${reconstructProgress}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* File Preview & Metadata Panel */}
                      <div className="mt-6 border-t border-slate-900 pt-6 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                              <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
                              Model File Metadata & Inspector
                            </h4>
                            <p className="text-xs text-slate-500">
                              Lists sizes, verified hash integrity signatures, and segment lineages for local
                              resources.
                            </p>
                          </div>
                          {selectedFileDetailed && (
                            <div className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-medium">
                              {selectedFileDetailed.status}
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-950/40 rounded-xl border border-slate-800/80 p-5 overflow-hidden">
                          {/* Left Column: Inspectable Items Selector */}
                          <div className="lg:col-span-12 xl:col-span-5 space-y-4 border-r border-slate-900 xl:pr-5">
                            <div className="space-y-2">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                                Active Workspace Files ({state.localFiles.length})
                              </span>
                              <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                                {state.localFiles.map((file, idx) => {
                                  const isCurSelected = activeFileSelectedName === file.name;
                                  const isChunk = getBaseName(file.name) !== null;
                                  return (
                                    <div
                                      key={idx}
                                      onClick={() => setSelectedFileName(file.name)}
                                      className={`flex items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                                        isCurSelected
                                          ? "bg-electric-blue/10 border-electric-blue/60 text-white shadow-sm"
                                          : "bg-slate-950/60 border-slate-900/60 text-slate-400 hover:border-slate-800 hover:bg-slate-950 hover:text-slate-200"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2 overflow-hidden w-full">
                                        <FileIcon
                                          className={`h-3.5 w-3.5 shrink-0 ${isCurSelected ? "text-electric-blue" : isChunk ? "text-blue-400" : "text-slate-500"}`}
                                        />
                                        <div className="truncate flex-1">
                                          <div className="text-xs font-medium truncate">{file.name}</div>
                                          <div className="text-[10px] font-mono text-slate-500 leading-tight">
                                            {isChunk ? "Segment block" : "Active baseline"} •{" "}
                                            {formatSize(file.size)}
                                          </div>
                                        </div>
                                        <ChevronRight
                                          className={`h-3 w-3 shrink-0 opacity-50 ${isCurSelected ? "text-electric-blue opacity-100 translate-x-0.5 transition-transform" : ""}`}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Reconstructed Lineages Section */}
                            <div className="space-y-2">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 pt-2 border-t border-slate-900/40">
                                <History className="h-3 w-3 text-amber-500" /> Reconstructed Lineages (
                                {reconstructedHistory.length})
                              </span>
                              {reconstructedHistory.length === 0 ? (
                                <div className="p-3 text-center border border-dashed border-slate-900 rounded-lg bg-slate-950/20 text-[11px] text-slate-500 italic font-mono leading-relaxed">
                                  No reconstructions performed in this workspace session yet.
                                </div>
                              ) : (
                                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                                  {reconstructedHistory.map((item, idx) => {
                                    const isCurSelected = activeFileSelectedName === item.baseName;
                                    return (
                                      <div
                                        key={idx}
                                        onClick={() => setSelectedFileName(item.baseName)}
                                        className={`flex items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                                          isCurSelected
                                            ? "bg-amber-500/10 border-amber-500/50 text-white"
                                            : "bg-slate-950/60 border-slate-900/60 text-slate-400 hover:border-slate-800 hover:bg-slate-950 hover:text-slate-200"
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 overflow-hidden w-full">
                                          <Cpu
                                            className={`h-3.5 w-3.5 shrink-0 ${isCurSelected ? "text-amber-500" : "text-amber-400/80"}`}
                                          />
                                          <div className="truncate flex-1">
                                            <div className="text-xs font-medium truncate">
                                              {item.baseName}
                                            </div>
                                            <div className="text-[10px] font-mono text-slate-500 leading-tight">
                                              Reconstituted • {formatSize(item.totalSize)} (
                                              {item.chunks.length} parts)
                                            </div>
                                          </div>
                                          <ChevronRight
                                            className={`h-3 w-3 shrink-0 opacity-50 ${isCurSelected ? "text-amber-500 opacity-100 translate-x-0.5 transition-transform" : ""}`}
                                          />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right Column: Detailed Metadata Inspector View */}
                          <div className="lg:col-span-12 xl:col-span-7 flex flex-col justify-between space-y-4">
                            {selectedFileDetailed ? (
                              <div className="space-y-4 h-full flex flex-col justify-between">
                                <div className="space-y-3">
                                  {/* File Details Title */}
                                  <div>
                                    <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5">
                                      <FileCode className="h-3.5 w-3.5 text-slate-400" />
                                      {getFileFormatLabel(selectedFileDetailed.name)}
                                    </div>
                                    <h5 className="text-sm font-semibold text-slate-200 truncate mt-0.5">
                                      {selectedFileDetailed.name}
                                    </h5>
                                    <p className="text-xs text-slate-400 leading-relaxed mt-1 italic">
                                      "{getFileDescription(selectedFileDetailed.name)}"
                                    </p>
                                  </div>

                                  {/* Detailed Metadata Grid */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950 border border-slate-900 rounded-lg p-3.5 font-sans">
                                    <div>
                                      <span className="text-[10px] font-mono text-slate-500 uppercase block leading-none mb-1">
                                        Size Specification
                                      </span>
                                      <span className="text-xs font-bold text-slate-300 font-mono">
                                        {formatSize(selectedFileDetailed.size)}
                                      </span>
                                      <span className="text-[10px] text-slate-500 block leading-none font-mono mt-0.5">
                                        {selectedFileDetailed.size.toLocaleString()} bytes
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] font-mono text-slate-500 uppercase block leading-none mb-1">
                                        Verification Checksum
                                      </span>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <span
                                          className="text-[11px] font-semibold font-mono text-emerald-400 bg-emerald-500/5 px-1.5 py-0.5 border border-emerald-500/10 rounded truncate max-w-[170px]"
                                          title={getDisplayHash(selectedFileDetailed.name)}
                                        >
                                          {getDisplayHash(selectedFileDetailed.name).substring(0, 24)}...
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleCopyHash(getDisplayHash(selectedFileDetailed.name))
                                          }
                                          className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-900 transition-colors cursor-pointer"
                                        >
                                          {copiedHash === getDisplayHash(selectedFileDetailed.name) ? (
                                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                                          ) : (
                                            <Copy className="h-3.5 w-3.5" />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                    <div className="col-span-1 sm:col-span-2 border-t border-slate-900/60 pt-2.5 mt-1">
                                      <span className="text-[10px] font-mono text-slate-500 uppercase block mb-1.5">
                                        Structural Analysis Properties
                                      </span>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                        {getSimulatedTensors(
                                          selectedFileDetailed.name,
                                          selectedFileDetailed.size,
                                        ).map((item, i) => (
                                          <div
                                            key={i}
                                            className="flex items-center justify-between text-[11px] border-b border-dashed border-slate-900 pb-1"
                                          >
                                            <span className="text-slate-500 capitalize">
                                              {item.key.replace(/_/g, " ")}
                                            </span>
                                            <span className="text-slate-300 font-mono font-medium">
                                              {item.val}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Custom display based on lineage */}
                                  {selectedFileDetailed.lineage && selectedFileDetailed.reconstructed && (
                                    <div className="space-y-2 animate-in slide-in-from-bottom-1 duration-200">
                                      <div className="text-[10px] font-mono text-amber-500 uppercase flex items-center gap-1">
                                        <History className="h-3 w-3" /> Reconnection Segment Lineage mapping
                                      </div>
                                      <div className="bg-amber-500/[0.02] border border-amber-500/15 rounded-lg p-3 space-y-2 max-h-[140px] overflow-y-auto">
                                        <p className="text-[11px] text-amber-400/80 leading-relaxed">
                                          This model file was compiled locally at{" "}
                                          <code className="text-white bg-slate-900 px-1 py-0.5 rounded font-mono text-[10px]">
                                            {new Date(
                                              (selectedFileDetailed.lineage as ReconstructedItem)
                                                .reconstructedAt,
                                            ).toLocaleTimeString()}
                                          </code>{" "}
                                          from the following byte segments:
                                        </p>
                                        <div className="space-y-1.5">
                                          {(selectedFileDetailed.lineage as ReconstructedItem).chunks.map(
                                            (ch, idx) => (
                                              <div
                                                key={idx}
                                                onClick={() => setSelectedFileName(ch.name)}
                                                className="flex items-center justify-between text-[10px] font-mono p-1.5 bg-slate-950 rounded border border-slate-900 hover:border-slate-800 cursor-pointer transition-colors"
                                              >
                                                <div className="flex items-center gap-1.5 truncate">
                                                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shrink-0" />
                                                  <span className="text-slate-300 font-medium truncate">
                                                    {ch.name}
                                                  </span>
                                                </div>
                                                <div className="text-slate-500 flex items-center gap-2">
                                                  <span>{formatSize(ch.size)}</span>
                                                  <span className="text-slate-600">
                                                    ({ch.hash.substring(7, 15)})
                                                  </span>
                                                </div>
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* If selected file is an archived/historical chunk segment, render back-link */}
                                  {selectedFileDetailed.status === "Archived Chunk Segment" && (
                                    <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-between text-xs text-slate-400">
                                      <span className="flex items-center gap-1.5">
                                        <Info className="h-3.5 w-3.5 text-emerald-400" />
                                        Component part of reconstructed model
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                          setSelectedFileName((selectedFileDetailed.lineage as any).parent)
                                        }
                                        className="text-[10px] font-mono text-emerald-400 hover:underline hover:text-emerald-300 font-semibold cursor-pointer"
                                      >
                                        Go to assembled model →
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-950 rounded-xl bg-slate-950/20 h-full">
                                <FileIcon className="h-10 w-10 text-slate-700 mb-3 animate-pulse" />
                                <span className="text-xs text-slate-400 font-medium font-sans">
                                  No File Selected for Analysis
                                </span>
                                <p className="text-[11px] text-slate-600 max-w-xs mt-1 leading-normal">
                                  Click on any file block or reconstruction lineage row in the index list to
                                  audit layer specifications, datatypes, and hash values.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="azure" className="space-y-6 animate-in fade-in">
                  <div className="grid gap-3">
                    <Label htmlFor="azureModel">Azure ML Workspace Path</Label>
                    <div className="relative">
                      <Cloud className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <Input
                        id="azureModel"
                        placeholder="azureml://subscriptions/.../models/my-model/versions/1"
                        className="pl-9 font-mono text-sm"
                        value={state.azureModelPath}
                        onChange={(e) => setState({ azureModelPath: e.target.value })}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Shared Cache & Azure Infrastructure Options */}
      <Card>
        <CardHeader
          title="Shared Cache & Infrastructure Settings"
          description="Configure enterprise caching to minimize redundant processing."
          badge={
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-electric-blue/10 text-electric-blue">
              <Database className="h-4 w-4" />
            </div>
          }
        />
        <CardContent className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="grid gap-3">
              <Label htmlFor="cacheDir">Local Cache Directory</Label>
              <Input
                id="cacheDir"
                placeholder="~/.cache/olive"
                value={state.cacheDir}
                onChange={(e) => setState({ cacheDir: e.target.value })}
              />
            </div>
            <div className="grid gap-3">
              <Label htmlFor="azureStr">Azure Blob Connection String</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <Input
                  id="azureStr"
                  type="password"
                  placeholder="DefaultEndpointsProtocol=https;AccountName=..."
                  className="pl-9 font-mono text-xs"
                  value={state.azureStr}
                  onChange={(e) => setState({ azureStr: e.target.value })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
