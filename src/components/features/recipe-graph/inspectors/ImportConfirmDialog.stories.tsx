import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { ImportConfirmDialog, type ImportConfirmPreset } from "./ImportConfirmDialog";

// ── Mock preset type matching PruningInspector's CustomPruningPreset shape ──

interface MockPreset extends ImportConfirmPreset {
  method: string;
  criteria: string;
  sparsity: number;
}

const presetDetail = (p: MockPreset) => `${p.method} · ${p.criteria} · ${(p.sparsity * 100).toFixed(0)}%`;

// ── Shared mock data ─────────────────────────────────────────────

const SAMPLE_PRESETS: MockPreset[] = [
  { label: "Aggressive", method: "magnitude", criteria: "l1_norm", sparsity: 0.7 },
  { label: "Balanced", method: "sparsegpt", criteria: "l2_norm", sparsity: 0.5 },
  { label: "Conservative", method: "wanda", criteria: "l1_norm", sparsity: 0.3 },
];

const COLLIDING_PRESETS: MockPreset[] = [
  { label: "Aggressive", method: "magnitude", criteria: "l1_norm", sparsity: 0.7 },
  { label: "Balanced", method: "sparsegpt", criteria: "l2_norm", sparsity: 0.5 },
  { label: "New Only", method: "wanda", criteria: "l2_norm", sparsity: 0.4 },
];

// ── Storybook meta ───────────────────────────────────────────────

const meta: Meta<typeof ImportConfirmDialog> = {
  title: "Components/ImportConfirmDialog",
  component: ImportConfirmDialog,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    backgrounds: { default: "dark" },
  },
  args: {
    onImport: fn(),
    onCancel: fn(),
    presetDetail,
  },
};

export default meta;
type Story = StoryObj<typeof ImportConfirmDialog>;

// ── Story 1: No collisions ───────────────────────────────────────

export const NoCollisions: Story = {
  name: "No Collisions",
  args: {
    importedPresets: SAMPLE_PRESETS,
    collisions: [],
    mergedPresets: SAMPLE_PRESETS,
  },
  parameters: {
    docs: {
      description: {
        story:
          "All imported presets are new — no existing presets share the same label. " +
          "Each preset shows a green dot indicating it will be added without overwriting.",
      },
    },
  },
};

// ── Story 2: With collisions ─────────────────────────────────────

export const WithCollisions: Story = {
  name: "With Collisions",
  args: {
    importedPresets: COLLIDING_PRESETS,
    collisions: ["Aggressive", "Balanced"],
    mergedPresets: COLLIDING_PRESETS,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Two of three imported presets share labels with existing custom presets. " +
          "Colliding presets show amber dots and 'will overwrite' labels. " +
          "The warning banner at the bottom summarizes the collision count.",
      },
    },
  },
};

// ── Story 3: Empty preset list ───────────────────────────────────

export const EmptyList: Story = {
  name: "Empty Preset List",
  args: {
    importedPresets: [],
    collisions: [],
    mergedPresets: [],
  },
  parameters: {
    docs: {
      description: {
        story:
          "No presets to import — the imported list is empty. " +
          "The dialog still renders with its header and action buttons, " +
          "though this state should rarely be reached in practice.",
      },
    },
  },
};

// ── Story 4: Single preset (edge case) ───────────────────────────

export const SinglePreset: Story = {
  name: "Single Preset",
  args: {
    importedPresets: [SAMPLE_PRESETS[0]],
    collisions: [],
    mergedPresets: [SAMPLE_PRESETS[0]],
  },
  parameters: {
    docs: {
      description: {
        story:
          "Only one preset is being imported. The header reads " +
          "'Import 1 preset' (singular) instead of 'Import 2 presets'.",
      },
    },
  },
};

// ── Story 5: All collisions ──────────────────────────────────────

export const AllCollisions: Story = {
  name: "All Collisions",
  args: {
    importedPresets: SAMPLE_PRESETS,
    collisions: SAMPLE_PRESETS.map((p) => p.label),
    mergedPresets: SAMPLE_PRESETS,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Every imported preset collides with an existing custom preset. " +
          "All three show amber dots and 'will overwrite' labels.",
      },
    },
  },
};
