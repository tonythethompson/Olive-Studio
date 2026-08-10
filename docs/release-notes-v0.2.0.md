# Olive Studio v0.2.0

Olive Studio is a GUI for [Microsoft Olive](https://github.com/microsoft/Olive) ONNX model optimization. Configure model sources, hardware targets, and optimization passes visually, then execute locally without cloud dependencies. Ships with an AI assistant (20 providers), hardware validation with one-click autofix, and an MCP server for agent-driven workflows.

## Highlights

- **Persistent MCP stdio connection**: warm tool calls under 50ms (was ~500ms per spawn)
- **Typed pass accessors** for compile-time safe pass configuration
- **Agent access policy** for MCP-origin job filtering and gated submit/cancel
- **Olive job heartbeat** so long silent runs no longer look hung
- **Pipeline state persistence** to localStorage (credentials stripped)
- **Security headers**: Helmet, CSP, Permissions-Policy, X-Robots-Tag
- Hardware probe and EP gate fixes (QNN, DirectML, TensorRT timeouts)
- Assistant UI reorganization (`AssistantSidebar`, focused assistant modules)

## Quick Start

```bash
git clone --branch v0.2.0 --depth 1 https://github.com/tonythethompson/Olive-Studio.git
cd Olive-Studio && pnpm install
pnpm dev
```

Open http://localhost:3000. No account or API key required for recipe building and local execution.

To follow `main` instead of this tagged release, omit `--branch v0.2.0`.

## Requirements

- Node.js >= 22.16
- pnpm >= 11.17
- Python >= 3.10 (for Olive execution and MCP server)

## Known Limitations

- **No Tauri installer**: desktop app builds but is unsigned (SmartScreen warnings on Windows)
- **Unsigned builds**: no code-signing certificate yet; Windows/macOS may flag the binary
- **No auto-update**: checkout a newer tag or pull `main` for updates

## What's Next

See [ROADMAP.md](./ROADMAP.md) for v0.3 plans: agent autonomy MCP tools (`execute_and_observe`, `plan_optimization`, `diagnose_and_fix`, and more).

## Full Changelog

https://github.com/tonythethompson/Olive-Studio/compare/v0.1.0...v0.2.0

## License

MIT
