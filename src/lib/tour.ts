import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

/**
 * Guided tour steps, in the order a first-time user meets the UI:
 * sidebar navigation, the four pipeline sections (top to bottom), then the
 * header affordances (Assistant, Settings). Steps anchor to stable landmarks —
 * section headings and `data-tour` attributes — rather than to lazily loaded
 * panel content, so every target exists as soon as the dashboard renders.
 */
export const TOUR_STEPS: DriveStep[] = [
  {
    element: 'nav[aria-label="Pipeline"]',
    popover: {
      title: "Your pipeline",
      description:
        "These four steps are the whole workflow: pick a model, target your hardware, build and run an optimization recipe, then try the result. Click any step to jump to it.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#input-heading",
    popover: {
      title: "1 · Model source",
      description:
        "Start here. Load a recipe preset, or point at a Hugging Face repo, a local folder, or an Azure model.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#ihv-heading",
    popover: {
      title: "2 · Hardware",
      description:
        "Choose where the optimized model will run — CPU, GPU, or NPU — and Olive Studio tailors the recipe to that execution provider.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#execute-heading",
    popover: {
      title: "3 · Recipe & run",
      description:
        "Review the generated Olive recipe, validate it, then export it as JSON or run it locally. You can also queue batch jobs here.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "#playground-heading",
    popover: {
      title: "4 · Playground",
      description:
        "Test the optimized model right in the browser: in-browser inference, WebGPU benchmarks, and the model Arena.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="assistant"]',
    popover: {
      title: "The Assistant",
      description:
        "Stuck on a pass or a validation error? Open the Assistant to ask questions about Olive and get help building your recipe.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="settings"]',
    popover: {
      title: "Replay this tour anytime",
      description:
        "That's the tour! You can run it again whenever you like from Settings → Take the tour.",
      side: "bottom",
      align: "end",
    },
  },
];

/**
 * Starts the guided tour and handles completion or dismissal.
 *
 * @param onSettled - Callback invoked once when the tour ends or is skipped
 * @returns The configured guided tour instance
 */
export function startGuidedTour(onSettled: () => void) {
  const driverObj = driver({
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    popoverClass: "olive-tour-popover",
    steps: TOUR_STEPS,
    onDestroyStarted: () => {
      onSettled();
      driverObj.destroy();
    },
  });
  driverObj.drive();
  return driverObj;
}
