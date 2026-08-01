export const PIPELINE_VIEW_IDS = ["input", "ihv", "execute"] as const;

export type PipelineViewId = (typeof PIPELINE_VIEW_IDS)[number];

export const OLIVE_PIPELINE_NAVIGATE = "olive-studio:navigate";
export const OLIVE_PIPELINE_NAV_BLOCKED = "olive-studio:navigate-blocked";

export const PIPELINE_NAV_BLOCKED_MESSAGE = "Unavailable while an Olive run is in progress";

export type PipelineNavBlockedDetail = {
  id: PipelineViewId;
  message: string;
};

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

function announcePipelineNavBlocked(id: PipelineViewId): void {
  window.dispatchEvent(
    new CustomEvent<PipelineNavBlockedDetail>(OLIVE_PIPELINE_NAV_BLOCKED, {
      detail: { id, message: PIPELINE_NAV_BLOCKED_MESSAGE },
    }),
  );
}

/**
 * Returns true when navigation to `id` is allowed.
 * When blocked, emits {@link OLIVE_PIPELINE_NAV_BLOCKED} for shared UI feedback.
 * Execute remains reachable during a run.
 */
export function attemptPipelineNavigate(id: PipelineViewId): boolean {
  if (olivePipelineRunning && id !== "execute") {
    announcePipelineNavBlocked(id);
    return false;
  }
  return true;
}

/** Switch the main pipeline step from nested panels (graph inspectors, etc.). */
export const navigatePipeline = (id: PipelineViewId) => {
  if (!attemptPipelineNavigate(id)) return;
  window.dispatchEvent(new CustomEvent(OLIVE_PIPELINE_NAVIGATE, { detail: id }));
};
