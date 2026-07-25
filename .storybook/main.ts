import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    // Ensure the @ alias resolves correctly for Storybook
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    // The Vite config already handles @ -> ./src via the project's vite.config.ts
    // but Storybook uses its own Vite build, so we need to add it here too.
    if (typeof config.resolve.alias === "object" && !("@" in config.resolve.alias)) {
      const { default: path } = await import("path");
      (config.resolve.alias as Record<string, string>)["@"] = path.resolve(__dirname, "../src");
    }
    return config;
  },
};

export default config;
