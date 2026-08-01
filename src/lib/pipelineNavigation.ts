export const PIPELINE_VIEW_IDS = ["input", "ihv", "execute"] as const;

export type PipelineViewId = (typeof PIPELINE_VIEW_IDS)[number];

export const OLIVE_PIPELINE_NAVIGATE = "olive-studio:navigate";

export function isPipelineViewId(value: unknown): value is PipelineViewId {
  return typeof value === "string" && (PIPELINE_VIEW_IDS as readonly string[]).includes(value);
}

let olivePipelineRunning = false;
type OliveRunningListener = () => void;
const oliveRunningListeners = new Set<OliveRunningListener>();

/** App sets this while Execute Live is in progress so inspectors can disable nav. */
export function setPipelineOliveRunning(running: boolean): void {
  if (olivePipelineRunning === running) return;
  olivePipelineRunning = running;
  for (const listener of oliveRunningListeners) listener();
}

export function isPipelineOliveRunning(): boolean {
  return olivePipelineRunning;
}

export function subscribePipelineOliveRunning(listener: OliveRunningListener): () => void {
  oliveRunningListeners.add(listener);
  return () => {
    oliveRunningListeners.delete(listener);
  };
}

/** Switch the main pipeline step from nested panels (graph inspectors, etc.). */
export const navigatePipeline = (id: PipelineViewId) => {
  window.dispatchEvent(new CustomEvent(OLIVE_PIPELINE_NAVIGATE, { detail: id }));
};
