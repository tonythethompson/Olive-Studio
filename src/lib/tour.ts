import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import tourDemoRecipe from "@/data/tour-demo-recipe.json";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import { isPipelineOliveRunning } from "@/lib/pipelineNavigation";
import { hasSelectedModel } from "@/lib/pipelineValidation";
import { createDefaultPipelineState, usePipelineStore } from "@/lib/stores/pipelineStore";

let tourModelUnsub: (() => void) | undefined;
let tourActive = false;

/**
 * Loads the bundled sample recipe when the workspace has no model selected.
 *
 * @returns Whether a sample recipe was applied
 */
export function ensureTourDemoModel(): { applied: boolean } {
  const store = usePipelineStore.getState();
  if (hasSelectedModel(store.state)) return { applied: false };
  try {
    const derived = deriveUiStateFromOliveRecipe(tourDemoRecipe, { replacePasses: true });
    store.replaceState({
      ...createDefaultPipelineState(),
      ...derived,
      passes: { ...createDefaultPipelineState().passes, ...derived.passes },
    });
    return { applied: hasSelectedModel(usePipelineStore.getState().state) };
  } catch {
    return { applied: false };
  }
}

/**
 * Guided tour steps: Olive overview, then real pipeline controls.
 * Interaction steps use click-to-advance; Model source waits for a real Apply.
 */
export const TOUR_STEPS: DriveStep[] = [
  {
    data: { id: "overview" },
    popover: {
      title: "What Olive is",
      description:
        "Olive is an open-source toolkit from Microsoft for optimizing and packaging machine learning models. It can convert models to ONNX and run optimizations like quantization, pruning, and caching so they run efficiently on your CPU, GPU, or NPU. Olive Studio is where you pick a model, choose your target hardware, and build that recipe.",
      align: "center",
    },
  },
  {
    data: { id: "pipeline" },
    element: 'nav[aria-label="Pipeline"]',
    advanceOnClick: true,
    popover: {
      title: "Your pipeline",
      description:
        "Your pipeline has four steps: pick a model, choose your target hardware, build and run a recipe, then try the result. Select any step to jump there.",
      side: "right",
      align: "start",
    },
  },
  {
    data: { id: "model-source" },
    element: '[data-tour="model-source"]',
    popover: {
      title: "Model source",
      description:
        "Pick a recipe to load your model. You can pull from the Hugging Face Hub, upload local weights, or use an Azure ML asset. Start with the sample recipe to keep the tour moving. Applying any recipe moves the tour forward.",
      side: "bottom",
      align: "start",
    },
  },
  {
    data: { id: "hardware" },
    element: '[data-tour="hardware-providers"]',
    advanceOnClick: true,
    waitForElement: 4000,
    popover: {
      title: "Hardware",
      description:
        "Select a provider card to set where the optimized model will run: CPU, GPU, or NPU.",
      side: "bottom",
      align: "start",
    },
  },
  {
    data: { id: "recipe" },
    element: '[data-tour="recipe-graph"]',
    advanceOnClick: true,
    waitForElement: 4000,
    popover: {
      title: "Recipe and run",
      description:
        "This graph is your Olive recipe. Select a node to see its details.",
      side: "bottom",
      align: "start",
    },
  },
  {
    data: { id: "playground" },
    element: "#playground-heading",
    popover: {
      title: "Playground",
      description:
        "Try the optimized model here: in-browser inference, WebGPU benchmarks, and the model Arena.",
      side: "top",
      align: "start",
    },
  },
  {
    data: { id: "assistant" },
    element: '[data-tour="assistant"]',
    advanceOnClick: true,
    popover: {
      title: "The Assistant",
      description:
        "Select Open Assistant to ask questions about Olive and get help building your recipe.",
      side: "bottom",
      align: "end",
    },
  },
  {
    data: { id: "settings" },
    element: '[data-tour="settings"]',
    popover: {
      title: "Replay this tour anytime",
      description:
        "That is the tour. Replay it anytime from Settings by selecting Take the tour.",
      side: "bottom",
      align: "end",
    },
  },
];

function stepId(step: DriveStep | undefined): string | undefined {
  const data = step?.data as { id?: string } | undefined;
  return data?.id;
}

/**
 * Starts the guided tour and handles completion or dismissal.
 *
 * @param onSettled - Callback invoked once when the tour ends or is skipped
 * @returns The tour instance, or null when an Olive job is running or a tour is already active
 */
export function startGuidedTour(onSettled: () => void) {
  if (isPipelineOliveRunning() || tourActive) return null;

  tourActive = true;
  const driverObj = driver({
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    popoverClass: "olive-tour-popover",
    allowKeyboardControl: true,
    disableActiveInteraction: false,
    steps: TOUR_STEPS,
    onNextClick: () => {
      if (stepId(driverObj.getActiveStep()) === "model-source") {
        ensureTourDemoModel();
      }
      driverObj.moveNext();
    },
    onHighlighted: (_element, step) => {
      tourModelUnsub?.();
      tourModelUnsub = undefined;
      if (stepId(step) !== "model-source") return;
      tourModelUnsub = usePipelineStore.subscribe((store) => {
        if (!hasSelectedModel(store.state)) return;
        tourModelUnsub?.();
        tourModelUnsub = undefined;
        driverObj.moveNext();
      });
    },
    onDeselected: () => {
      tourModelUnsub?.();
      tourModelUnsub = undefined;
    },
    onDestroyStarted: () => {
      tourModelUnsub?.();
      tourModelUnsub = undefined;
      tourActive = false;
      onSettled();
      driverObj.destroy();
    },
  });
  driverObj.drive();
  return driverObj;
}
