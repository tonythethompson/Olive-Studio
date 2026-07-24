export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      [
        "recipe-builder",
        "pipeline-validation",
        "recipe-pipeline",
        "quantization",
        "pruning",
        "peft",
        "conversion",
        "hardware-probe",
        "ai-assistant",
        "graph",
        "batch",
        "infra",
        "ui",
        "deps",
        "ci",
        "docs",
      ],
    ],
  },
};
