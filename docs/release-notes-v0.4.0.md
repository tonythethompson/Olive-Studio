# Olive Studio v0.4.0

Olive Studio is a GUI for [Microsoft Olive](https://github.com/microsoft/Olive) ONNX model optimization. Configure model sources, hardware targets, and optimization passes visually, then run recipes on your own machine without setting up a cloud service first. This release focuses on better agent workflows, a more usable assistant UI, smaller bundles, and more reliable hardware detection.

## Highlights

- **Agent MCP workflow tools** — new plan, execute, diagnose, compare, and model-info flows make it easier for coding agents to inspect recipes and help with optimization work.
- **Assistant UI overhaul** — the assistant can now expand full-screen, switch to card view automatically at narrow widths, and show model footprint details in the collapsed rail.
- **`olive-ai` 0.13.0 upgrade** — updated pass catalog, validation behavior, and migration support for newer Olive recipes.
- **Smaller client bundle** — lazy MCP UI loading and shared utility cleanup reduce shipped frontend weight and improve load behavior.
- **Hardware detection fixes** — CUDA, TensorRT, and NVIDIA fallback behavior are more accurate, especially on machines where support is partial or not yet installed.
- **Cross-platform polish** — accessibility, symlink handling, session binding, and install-path behavior received another round of hardening.

## Quick Start

```bash
git clone --branch v0.4.0 --depth 1 https://github.com/tonythethompson/Olive-Studio.git
cd Olive-Studio && pnpm install
pnpm dev
```

Open http://localhost:3000. No account or API key is required for recipe building and local execution.

To follow `main` instead of this tagged release, omit `--branch v0.4.0`.

### Updating from a tagged clone

`--branch v0.4.0` checks out a tag (detached HEAD). `git pull` will not move you to a newer release. When a newer tag is published on [Releases](https://github.com/tonythethompson/Olive-Studio/releases), fetch and check it out:

```bash
git fetch --depth 1 origin tag vX.Y.Z
git checkout vX.Y.Z
pnpm install
```

Replace `vX.Y.Z` with the tag name. Or clone `main` if you want continuous updates with `git pull`.

## Requirements

- Node.js >= 22.16
- pnpm >= 11.17
- Python >= 3.10 (for Olive execution and MCP server)

## Known Limitations

- **No Tauri installer** — desktop app builds, but the packaged app is still unsigned
- **Unsigned builds** — Windows and macOS may warn until code signing is in place
- **No auto-update** — from a tagged clone, fetch and check out a newer tag (see above); do not rely on `git pull`

## What's Next

See [ROADMAP.md](./ROADMAP.md) for the latest plans after `v0.4.0`, including follow-on UI, workflow, and optimization improvements.

## Full Changelog

https://github.com/tonythethompson/Olive-Studio/compare/v0.2.0...v0.4.0

## License

MIT
