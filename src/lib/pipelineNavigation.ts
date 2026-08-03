export const PIPELINE_VIEW_IDS = ["input", "ihv", "execute", "playground"] as const;

export type PipelineViewId = (typeof PIPELINE_VIEW_IDS)[number];

export const OLIVE_PIPELINE_NAVIGATE = "olive-studio:navigate";
export const OLIVE_PIPELINE_NAV_BLOCKED = "olive-studio:navigate-blocked";

export const PIPELINE_NAV_BLOCKED_MESSAGE = "Unavailable while an Olive run is in progress";

export type PipelineNavBlockedDetail = {
  id: PipelineViewId;
  message: string;
};

/**
 * Determines whether a value identifies a supported pipeline view.
 *
 * @param value - The value to check
 * @returns `true` if the value is a supported pipeline view ID, `false` otherwise
 */
export function isPipelineViewId(value: unknown): value is PipelineViewId {
  return typeof value === "string" && (PIPELINE_VIEW_IDS as readonly string[]).includes(value);
}

let olivePipelineRunning = false;
type OliveRunningListener = () => void;
const oliveRunningListeners = new Set<OliveRunningListener>();

/**
 * Updates whether Execute Live is currently running.
 *
 * @param running - Whether Execute Live is in progress
 */
export function setPipelineOliveRunning(running: boolean): void {
  if (olivePipelineRunning === running) return;
  olivePipelineRunning = running;
  for (const listener of oliveRunningListeners) listener();
}

/**
 * Gets the current Execute Live running state.
 *
 * @returns `true` if Execute Live is running, `false` otherwise.
 */
export function isPipelineOliveRunning(): boolean {
  return olivePipelineRunning;
}

/**
 * Subscribes to changes in the pipeline Execute Live running state.
 *
 * @param listener - The function called when the running state changes
 * @returns A function that removes the listener
 */
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
 * Execute and Playground remain reachable during a run.
 */
export function attemptPipelineNavigate(id: PipelineViewId): boolean {
  if (olivePipelineRunning && id !== "execute" && id !== "playground") {
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
