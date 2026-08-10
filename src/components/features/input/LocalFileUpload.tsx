/**
 * LocalFileUpload — Local model source tab with file upload, chunk reconstruction,
 * and metadata inspector. Extracted from InputEnvironmentPanel (Task 5).
 */
import { useState, useRef, useEffect, type ChangeEvent } from "react";
import { Button, Label } from "@/components/ui";
import type { UIState } from "@/types";
import { getFileDetailedInfo as resolveFileDetailedInfo } from "@/lib/localFileDetails";
import {
  getBaseName,
  formatFileSize,
  getFileFormatLabel,
  getFileDescription,
  getSimulatedTensors,
  getReconstructableGroups,
} from "@/components/features/input/localFileUtils";
import {
  FolderUp,
  File as FileIcon,
  X,
  Layers,
  Loader2,
  Check,
  Copy,
  ChevronRight,
  Info,
  FileCode,
  Activity,
  Cpu,
  History,
  DownloadCloud,
} from "lucide-react";

interface ReconstructedItem {
  baseName: string;
  totalSize: number;
  finalHash: string;
  chunks: { name: string; size: number; hash: string }[];
  reconstructedAt: string;
}

export type ConfigTextStatus = "idle" | "loading" | "ready";

export interface LocalFileUploadProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  onConfigTextChange?: (text: string | undefined, status: ConfigTextStatus) => void;
}

export function LocalFileUpload({ state, setState, onConfigTextChange }: LocalFileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chunkFilesRef = useRef<Map<string, File>>(new Map());
  const [isReconstructing, setIsReconstructing] = useState(false);
  const [reconstructProgress, setReconstructProgress] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [reconstructedHistory, setReconstructedHistory] = useState<ReconstructedItem[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState<string | null>(null);

  const syncChunkFilesRefToState = (localFiles: UIState["localFiles"]) => {
    const allowed = new Set(localFiles.map((f) => f.name));
    for (const name of chunkFilesRef.current.keys()) {
      if (!allowed.has(name)) {
        chunkFilesRef.current.delete(name);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    syncChunkFilesRefToState(state.localFiles);

    const hasConfigInState = state.localFiles.some((f) => f.name === "config.json");
    if (!hasConfigInState) {
      onConfigTextChange?.(undefined, state.localFiles.length === 0 ? "idle" : "ready");
      return () => { cancelled = true; };
    }

    const configFile = chunkFilesRef.current.get("config.json");
    if (!configFile) {
      onConfigTextChange?.(undefined, "ready");
      return () => { cancelled = true; };
    }

    onConfigTextChange?.(undefined, "loading");
    void configFile.text().then((text) => {
      if (!cancelled) onConfigTextChange?.(text, "ready");
    }).catch(() => {
      if (!cancelled) onConfigTextChange?.(undefined, "ready");
    });
    return () => { cancelled = true; };
  }, [state.localFiles, onConfigTextChange]);

  const getDisplayHash = (name: string): string | null => {
    const recon = reconstructedHistory.find((r) => r.baseName === name);
    if (recon) return recon.finalHash;
    for (const r of reconstructedHistory) {
      const chunk = r.chunks.find((c) => c.name === name);
      if (chunk) return chunk.hash;
    }
    return null;
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      for (const f of newFiles as File[]) {
        chunkFilesRef.current.set(f.name, f);
      }
      const newFileMetas = newFiles.map((f: File) => ({ name: f.name, size: f.size }));
      const existingNames = new Set(state.localFiles.map((f) => f.name));
      const filteredNew = newFileMetas.filter((f) => !existingNames.has(f.name));
      const combined = [...state.localFiles, ...filteredNew].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      setState({ localFiles: combined });
      if (filteredNew.length > 0 && !selectedFileName) {
        setSelectedFileName(filteredNew[0].name);
      }
    }
  };

  const removeFile = (name: string) => {
    chunkFilesRef.current.delete(name);
    const updatedFiles = state.localFiles.filter((f) => f.name !== name);
    setState({ localFiles: updatedFiles });
    if (selectedFileName === name) {
      setSelectedFileName(updatedFiles.length > 0 ? updatedFiles[0].name : null);
    }
  };

  const reconstructableGroups = () => getReconstructableGroups(state.localFiles);

  const startReconstruction = async (baseName: string, files: { name: string; size: number }[]) => {
    setIsReconstructing(true);
    setReconstructProgress(0);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
      setDownloadName(null);
    }
    try {
      const sortedFiles = [...files].sort((a, b) => {
        const numA = parseInt(a.name.match(/(\d+)$/)?.[1] || "0");
        const numB = parseInt(b.name.match(/(\d+)$/)?.[1] || "0");
        return numA - numB;
      });
      const totalBytes = sortedFiles.reduce((acc, f) => acc + f.size, 0);
      let bytesRead = 0;
      const buffers: ArrayBuffer[] = [];
      const generatedChunks: { name: string; size: number; hash: string }[] = [];
      for (const fileMeta of sortedFiles) {
        const fileObj = chunkFilesRef.current.get(fileMeta.name);
        if (!fileObj) {
          throw new Error(`File object not found for chunk: ${fileMeta.name}. Please re-select the files.`);
        }
        const buffer = await fileObj.arrayBuffer();
        buffers.push(buffer);
        const chunkDigest = await crypto.subtle.digest("SHA-256", buffer);
        const chunkHex = Array.from(new Uint8Array(chunkDigest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        generatedChunks.push({ name: fileMeta.name, size: fileMeta.size, hash: `sha256:${chunkHex}` });
        bytesRead += buffer.byteLength;
        setReconstructProgress(Math.round((bytesRead / totalBytes) * 100));
      }
      const blob = new Blob(buffers);
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setDownloadName(baseName);
      const combined = await blob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      const finalHash = `sha256:${hashHex}`;
      setReconstructedHistory((prev) => [
        ...prev,
        { baseName, totalSize: blob.size, finalHash, chunks: generatedChunks, reconstructedAt: new Date().toISOString() },
      ]);
      const chunkNames = new Set(files.map((f) => f.name));
      for (const name of chunkNames) {
        chunkFilesRef.current.delete(name);
      }
      const newLocalFiles = state.localFiles.filter((f) => !chunkNames.has(f.name));
      setState({ localFiles: [...newLocalFiles, { name: baseName, size: blob.size }] });
      setSelectedFileName(baseName);
    } catch (err: unknown) {
      console.error("Reconstruction failed:", err);
      alert(`Reconstruction failed: ${(err as Error).message}`);
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

  const getFileDetailedInfo = (name: string | null) =>
    resolveFileDetailedInfo(name, state.localFiles, reconstructedHistory);

  const selectedFileDetailed = getFileDetailedInfo(activeFileSelectedName);

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="border-2 border-dashed border-slate-800 rounded-xl p-8 flex flex-col items-center justify-center bg-slate-900/30 text-center hover:bg-slate-900/50 transition-colors">
        <div className="h-12 w-12 rounded-full bg-electric-blue/10 flex items-center justify-center mb-4">
          <FolderUp className="h-6 w-6 text-electric-blue" />
        </div>
        <h4 className="font-medium text-slate-200 mb-1">Upload Local Model Files</h4>
        <p className="text-sm text-slate-500 mb-6 max-w-md">
          Select your model weights and configurations. For massive LLMs, you can upload
          chunked weights (e.g. <code className="text-electric-blue">.bin.001</code>,{" "}
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
            {state.localFiles.map((file) => {
              const isChunk = getBaseName(file.name) !== null;
              const isCurSelected = activeFileSelectedName === file.name;
              return (
                <div
                  key={file.name}
                  className={`flex items-center justify-between p-3 rounded-lg border group transition-all ${isCurSelected
                    ? "bg-electric-blue/10 border-electric-blue/60 shadow-sm ring-1 ring-electric-blue/25"
                    : isChunk
                      ? "bg-slate-900 border-electric-blue/25 hover:border-slate-700 hover:bg-slate-900/80"
                      : "bg-slate-950 border-slate-800 hover:border-slate-700 hover:bg-slate-950/80"
                    }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFileName(file.name)}
                    aria-label={`Select ${file.name}`}
                    aria-pressed={isCurSelected}
                    className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden text-left cursor-pointer bg-transparent border-0 p-0"
                  >
                    <FileIcon
                      className={`h-4 w-4 shrink-0 transition-colors ${isCurSelected ? "text-electric-blue" : isChunk ? "text-blue-400" : "text-slate-500"}`}
                    />
                    <div className="truncate">
                      <p className={`text-sm font-medium truncate transition-colors ${isCurSelected ? "text-white" : "text-slate-300 group-hover:text-slate-200"}`}>
                        {file.name}
                      </p>
                      <p className="text-sm text-slate-500 font-mono">{formatFileSize(file.size)}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={(e) => { e.stopPropagation(); removeFile(file.name); }}
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
            <div key={base} className="mt-4 p-4 rounded-lg bg-electric-blue/5 border border-electric-blue/20">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h5 className="text-sm font-medium text-electric-blue flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Model Reconstruction Available
                  </h5>
                  <p className="text-sm text-slate-400">
                    Detected {files.length} parts for <strong>{base}</strong> ({formatFileSize(files.reduce((a, b) => a + b.size, 0))}).
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <Button
                    variant="outline"
                    className="border-electric-blue/50 text-electric-blue hover:bg-electric-blue hover:text-slate-950"
                    onClick={() => startReconstruction(base, files)}
                    disabled={isReconstructing}
                  >
                    {isReconstructing ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Assembling...</>
                    ) : (
                      "Reconstruct Binary"
                    )}
                  </Button>
                  {downloadUrl && downloadName && (
                    <a
                      href={downloadUrl}
                      download={downloadName}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded text-sm text-emerald-400 font-semibold transition-all"
                    >
                      <DownloadCloud className="h-3.5 w-3.5" />
                      Download {downloadName}
                    </a>
                  )}
                </div>
              </div>
              {isReconstructing && (
                <div className="mt-4 space-y-1.5 animate-in fade-in">
                  <div className="flex justify-between text-sm text-electric-blue font-mono">
                    <span>Progress</span>
                    <span>{Math.round(reconstructProgress)}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
                    <div className="h-full bg-electric-blue transition-all duration-200 ease-out" style={{ width: `${reconstructProgress}%` }} />
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
                <p className="text-sm text-slate-500">
                  Lists sizes, verified hash integrity signatures, and segment lineages for local resources.
                </p>
              </div>
              {selectedFileDetailed && (
                <div className="text-[11px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-medium">
                  {selectedFileDetailed.status}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-950/40 rounded-xl border border-slate-800/80 p-5 overflow-hidden">
              {/* Left Column: Inspectable Items Selector */}
              <div className="lg:col-span-12 xl:col-span-5 space-y-4 border-r border-slate-900 xl:pr-5">
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Active Workspace Files ({state.localFiles.length})
                  </span>
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                    {state.localFiles.map((file) => {
                      const isCurSelected = activeFileSelectedName === file.name;
                      const isChunk = getBaseName(file.name) !== null;
                      return (
                        <button
                          type="button"
                          key={file.name}
                          onClick={() => setSelectedFileName(file.name)}
                          aria-label={`Select ${file.name}`}
                          aria-pressed={isCurSelected}
                          className={`flex w-full items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-all ${isCurSelected
                            ? "bg-electric-blue/10 border-electric-blue/60 text-white shadow-sm"
                            : "bg-slate-950/60 border-slate-900/60 text-slate-400 hover:border-slate-800 hover:bg-slate-950 hover:text-slate-200"
                            }`}
                        >
                          <div className="flex items-center gap-2 overflow-hidden w-full">
                            <FileIcon className={`h-3.5 w-3.5 shrink-0 ${isCurSelected ? "text-electric-blue" : isChunk ? "text-blue-400" : "text-slate-500"}`} />
                            <div className="truncate flex-1">
                              <div className="text-sm font-medium truncate">{file.name}</div>
                              <div className="text-[11px] font-mono text-slate-500 leading-tight">
                                {isChunk ? "Segment block" : "Active baseline"} • {formatFileSize(file.size)}
                              </div>
                            </div>
                            <ChevronRight className={`h-3 w-3 shrink-0 opacity-50 ${isCurSelected ? "text-electric-blue opacity-100 translate-x-0.5 transition-transform" : ""}`} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Reconstructed Lineages Section */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 pt-2 border-t border-slate-900/40">
                    <History className="h-3 w-3 text-amber-500" /> Reconstructed Lineages ({reconstructedHistory.length})
                  </span>
                  {reconstructedHistory.length === 0 ? (
                    <div className="p-3 text-center border border-dashed border-slate-900 rounded-lg bg-slate-950/20 text-xs text-slate-500 italic font-sans leading-relaxed">
                      No reconstructions performed in this workspace session yet.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                      {reconstructedHistory.map((item) => {
                        const isCurSelected = activeFileSelectedName === item.baseName;
                        return (
                          <button
                            type="button"
                            key={item.baseName}
                            onClick={() => setSelectedFileName(item.baseName)}
                            aria-label={`Select reconstructed ${item.baseName}`}
                            aria-pressed={isCurSelected}
                            className={`flex w-full items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-all ${isCurSelected
                              ? "bg-amber-500/10 border-amber-500/50 text-white"
                              : "bg-slate-950/60 border-slate-900/60 text-slate-400 hover:border-slate-800 hover:bg-slate-950 hover:text-slate-200"
                              }`}
                          >
                            <div className="flex items-center gap-2 overflow-hidden w-full">
                              <Cpu className={`h-3.5 w-3.5 shrink-0 ${isCurSelected ? "text-amber-500" : "text-amber-400/80"}`} />
                              <div className="truncate flex-1">
                                <div className="text-sm font-medium truncate">{item.baseName}</div>
                                <div className="text-[11px] font-mono text-slate-500 leading-tight">
                                  Reconstituted • {formatFileSize(item.totalSize)} ({item.chunks.length} parts)
                                </div>
                              </div>
                              <ChevronRight className={`h-3 w-3 shrink-0 opacity-50 ${isCurSelected ? "text-amber-500 opacity-100 translate-x-0.5 transition-transform" : ""}`} />
                            </div>
                          </button>
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
                      <div>
                        <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
                          <FileCode className="h-3.5 w-3.5 text-slate-400" />
                          {getFileFormatLabel(selectedFileDetailed.name)}
                        </div>
                        <h5 className="text-sm font-semibold text-slate-200 truncate mt-0.5">
                          {selectedFileDetailed.name}
                        </h5>
                        <p className="text-sm text-slate-400 leading-relaxed mt-1 italic">
                          &quot;{getFileDescription(selectedFileDetailed.name)}&quot;
                        </p>
                      </div>

                      {/* Detailed Metadata Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950 border border-slate-900 rounded-lg p-3.5 font-sans">
                        <div>
                          <span className="text-[11px] font-mono text-slate-500 uppercase block leading-none mb-1">Size Specification</span>
                          <span className="text-sm font-bold text-slate-300 font-mono">{formatFileSize(selectedFileDetailed.size)}</span>
                          <span className="text-[11px] text-slate-500 block leading-none font-mono mt-0.5">{selectedFileDetailed.size.toLocaleString()} bytes</span>
                        </div>
                        <div>
                          <span className="text-[11px] font-mono text-slate-500 uppercase block leading-none mb-1">Verification Checksum</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {(() => {
                              const displayHash = getDisplayHash(selectedFileDetailed.name);
                              if (!displayHash) {
                                return (
                                  <span className="text-xs font-mono text-slate-500 px-1.5 py-0.5 border border-slate-800 rounded">not hashed</span>
                                );
                              }
                              return (
                                <>
                                  <span className="text-xs font-semibold font-mono text-emerald-400 bg-emerald-500/5 px-1.5 py-0.5 border border-emerald-500/10 rounded truncate max-w-[170px]" title={displayHash}>
                                    {displayHash.substring(0, 24)}...
                                  </span>
                                  <button
                                    type="button"
                                    aria-label="Copy verification checksum"
                                    onClick={() => handleCopyHash(displayHash)}
                                    className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-900 transition-colors cursor-pointer"
                                  >
                                    {copiedHash === displayHash ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                                  </button>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="col-span-1 sm:col-span-2 border-t border-slate-900/60 pt-2.5 mt-1">
                          <span className="text-[11px] font-mono text-slate-500 uppercase block mb-1.5">Structural Analysis Properties</span>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                            {getSimulatedTensors(selectedFileDetailed.name, selectedFileDetailed.size, getDisplayHash).map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-xs border-b border-dashed border-slate-900 pb-1">
                                <span className="text-slate-500 capitalize">{item.key.replace(/_/g, " ")}</span>
                                <span className="text-slate-300 font-mono font-medium">{item.val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Lineage display for reconstructed files */}
                      {selectedFileDetailed.lineage && selectedFileDetailed.reconstructed && (
                        <div className="space-y-2 animate-in slide-in-from-bottom-1 duration-200">
                          <div className="text-[11px] font-mono text-amber-500 uppercase flex items-center gap-1">
                            <History className="h-3 w-3" /> Reconnection Segment Lineage mapping
                          </div>
                          <div className="bg-amber-500/[0.02] border border-amber-500/15 rounded-lg p-3 space-y-2 max-h-[140px] overflow-y-auto">
                            <p className="text-xs text-amber-400/80 leading-relaxed">
                              This model file was compiled locally at{" "}
                              <code className="text-white bg-slate-900 px-1 py-0.5 rounded font-mono text-[11px]">
                                {new Date(selectedFileDetailed.lineage.reconstructedAt).toLocaleTimeString()}
                              </code>{" "}
                              from the following byte segments:
                            </p>
                            <div className="space-y-1.5">
                              {selectedFileDetailed.lineage.chunks.map((ch) => (
                                <button
                                  type="button"
                                  key={ch.name}
                                  onClick={() => setSelectedFileName(ch.name)}
                                  aria-label={`Select chunk ${ch.name}`}
                                  className="flex w-full items-center justify-between text-[11px] font-mono p-1.5 bg-slate-950 rounded border border-slate-900 hover:border-slate-800 cursor-pointer transition-colors text-left"
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shrink-0" />
                                    <span className="text-slate-300 font-medium truncate">{ch.name}</span>
                                  </div>
                                  <div className="text-slate-500 flex items-center gap-2">
                                    <span>{formatFileSize(ch.size)}</span>
                                    <span className="text-slate-600">({ch.hash.substring(7, 15)})</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Back-link for archived chunk segments */}
                      {selectedFileDetailed.status === "Archived Chunk Segment" &&
                        selectedFileDetailed.lineage &&
                        "parent" in selectedFileDetailed.lineage && (
                          <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-between text-sm text-slate-400">
                            <span className="flex items-center gap-1.5">
                              <Info className="h-3.5 w-3.5 text-emerald-400" />
                              Component part of reconstructed model
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const lineage = selectedFileDetailed.lineage;
                                if (lineage && "parent" in lineage) {
                                  setSelectedFileName(lineage.parent);
                                }
                              }}
                              className="text-[11px] font-mono text-emerald-400 hover:underline hover:text-emerald-300 font-semibold cursor-pointer"
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
                    <span className="text-sm text-slate-400 font-medium font-sans">No File Selected for Analysis</span>
                    <p className="text-xs text-slate-600 max-w-xs mt-1 leading-normal">
                      Click on any file block or reconstruction lineage row in the index list to audit layer specifications, datatypes, and hash values.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
