export type PipelineViewId = "input" | "ihv" | "execute";

export const OLIVE_PIPELINE_NAVIGATE = "olive-studio:navigate";

/** Switch the main pipeline step from nested panels (graph inspectors, etc.). */
export const navigatePipeline = (id: PipelineViewId) => {
  window.dispatchEvent(new CustomEvent(OLIVE_PIPELINE_NAVIGATE, { detail: id }));
};
