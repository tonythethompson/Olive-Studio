import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { isPipelineOliveRunning } from "@/lib/pipelineNavigation";
import { usePipelineStore, createDefaultPipelineState } from "@/lib/stores/pipelineStore";
import { hasSelectedModel } from "@/lib/pipelineValidation";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import tourDemoRecipe from "@/data/tour-demo-recipe.json";

let tourActive = false;

/**
 * Guided tour steps: Olive overview, then real pipeline controls.
 * Interaction steps use click-to-advance.
 */
export const TOUR_STEPS: DriveStep[] = [
  {
    data: { id: "overview" },
    popover: {
      title: "Meet Olive",
      description:
        "Olive is an open-source toolkit from Microsoft for optimizing machine learning models. It can convert models to ONNX and run optimizations like quantization and pruning so they run efficiently on your CPU, GPU, or NPU. Olive Studio is where you pick a model, choose your target hardware, and build that recipe.",
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
        "Your pipeline has four steps: pick a model, choose your target hardware, build and run a recipe, then try the result. Select the first step, Model source, to continue.",
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
        "Select a recipe to load the model you want to optimize. We'll auto-fill the Hugging Face URL so it downloads during the Olive run. You can also point to a different HF repo, use local weights, or reference an Azure ML asset.",
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
        "Select your target to set where the optimized model will run: CPU, GPU, or NPU.",
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
        "This graph is your Olive recipe. Select a node to see its details, then hit Run to execute the pipeline.",
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
        "Try the optimized model here: in-browser inference, WebGPU benchmarks, and side-by-side model comparison in the Arena.",
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
        "You're all set. Replay this tour anytime from Settings by selecting Take the tour.",
      side: "bottom",
      align: "end",
    },
  },
];

/**
 * Applies the bundled sample recipe when no model is currently selected.
 * Used by the tour and the InputRecipeRail "Apply" button.
 * Returns `{ applied: true }` only the first time it actually writes state.
 */
export function ensureTourDemoModel(): { applied: boolean } {
  const store = usePipelineStore.getState();
  if (hasSelectedModel(store.state)) return { applied: false };
  try {
    const defaults = createDefaultPipelineState();
    const derived = deriveUiStateFromOliveRecipe(tourDemoRecipe, { replacePasses: true });
    store.replaceState({
      ...defaults,
      ...derived,
      passes: {
        ...defaults.passes,
        ...(derived.passes ?? {}),
      },
    });
    return { applied: true };
  } catch {
    return { applied: false };
  }
}

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
      driverObj.moveNext();
    },
    onDestroyStarted: () => {
      tourActive = false;
      onSettled();
      driverObj.destroy();
    },
  });
  driverObj.drive();
  return driverObj;
}
