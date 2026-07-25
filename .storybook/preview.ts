import type { Preview } from "@storybook/react";
import "../src/index.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#0D0E0A" },
        { name: "slate-950", value: "#0D0E0A" },
        { name: "light", value: "#F5F3EC" },
      ],
    },
    viewport: {
      viewports: {
        compact: { name: "Compact", styles: { width: "320px", height: "480px" } },
        default: { name: "Default", styles: { width: "400px", height: "600px" } },
        wide: { name: "Wide", styles: { width: "640px", height: "480px" } },
      },
    },
  },
};

export default preview;
