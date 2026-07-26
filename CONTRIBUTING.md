# Contributing to Olive Studio

Thank you for your interest in Olive Studio. This project is a community front end for [Microsoft Olive](https://github.com/microsoft/Olive). Contributions that improve the recipe builder, validation, hardware integration, or documentation are welcome.

## Before you start

- Read [README.md](README.md) for setup and architecture overview.
- Read [ABOUT.md](ABOUT.md) for project scope — Olive Studio is a local runner and UI, not a fork of Olive itself.
- Olive Studio is licensed under the [MIT License](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.

## Development setup

### Requirements

- **Node.js** 22+ (pnpm 11 requirement)
- **Python** 3.9+ on `PATH` (for live Olive runs and GPU testing)
- **Git**

### Install and run

```bash
git clone https://github.com/tonythethompson/Olive-Studio.git
cd Olive-Studio
pnpm install
pnpm dev
```

Open <http://localhost:3000>. On first **Execute Live**, the server creates `.venv/` and installs `olive-ai` automatically.

Optional: copy `.env.local` for `HF_TOKEN` or AI provider keys (see README).

## What to work on

Good first contributions:

- Documentation fixes and clarifications
- Recipe validation rules and user-facing error messages
- Execution-provider compatibility and hardware probe improvements
- UI polish in the recipe graph or inspectors
- Smoke tests in `scripts/validate-recipe-builder.ts`

Larger changes (new passes, new providers, server dependency logic) are welcome but should be discussed in an issue first so the approach aligns with Olive’s upstream APIs.

## Project conventions

### Keep changes focused

- Prefer small, reviewable PRs over large refactors.
- Match existing naming, file layout, and TypeScript patterns in `src/`.
- Put shared recipe logic in `src/lib/` (especially `pipelineValidation.ts`, `oliveRecipeBuilder.ts`, `recipePipeline.ts`).
- Place imports at the top of modules — no inline imports unless required for a documented circular dependency.

### Recipe and validation changes

If you change how UI state maps to Olive JSON:

1. Update `src/lib/oliveRecipeBuilder.ts` and any import/export logic in `src/lib/oliveRecipeHub.ts`.
2. Extend rules in `src/lib/pipelineValidation.ts` when pass ↔ provider compatibility changes.
3. Add or update assertions in `scripts/validate-recipe-builder.ts`.
4. Regenerate the catalog only when upstream olive-recipes paths change: `pnpm generate:recipes`.

### Server and GPU runtime

- Olive spawn, dependency install, and PATH logic live in `server.ts` and `scripts/olive_gpu_launcher.py`.
- GPU package pins are centralized in `src/lib/oliveGpuRuntime.ts`, `tensorrtDeps.ts`, and `tensorrtRtxDeps.ts`.

## Checks before opening a PR

Run these locally (CI runs the same on Ubuntu):

```bash
pnpm lint
pnpm validate:recipe
```

For UI or server changes, manually smoke-test:

1. `pnpm dev`
2. Build or load a recipe, confirm validation banners behave as expected
3. If touching execution: run **Execute Live** with a small CPU recipe when possible

Production build (optional):

```bash
pnpm build
pnpm start
```

## Pull request guidelines

1. **Branch** from `main` with a descriptive name (e.g. `fix/quant-method-import`, `docs/contributing`).
2. **Describe** what changed and why — include steps to reproduce for bug fixes.
3. **Link** related issues when applicable.
4. **Screenshots** help for visible UI changes.
5. Ensure CI passes — typecheck and recipe builder smoke test.

Reviewers may ask for smaller scope or additional tests; that keeps the codebase maintainable as Olive upstream evolves.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) style:

| Prefix      | Use for                             |
| ----------- | ----------------------------------- |
| `feat:`     | New user-facing capability          |
| `fix:`      | Bug fixes                           |
| `docs:`     | Documentation only                  |
| `refactor:` | Code change without behavior change |
| `test:`     | Tests or smoke scripts              |
| `chore:`    | Tooling, deps, CI                   |

Examples:

```
fix: map catalog static quant_mode to PTQ not QAT
docs: add CONTRIBUTING guide for new contributors
feat: surface TensorRT RTX in hardware probe results
```

## Reporting issues

Include as much as possible:

- OS and Node/Python versions
- Execution provider and GPU (if relevant)
- Steps to reproduce
- Recipe JSON or catalog path used
- Relevant log lines from the Execute panel (stderr especially)

For Olive CLI errors, note the `olive-ai` version in `.venv` if you know it (`pip show olive-ai`).

## Code of conduct

Be respectful and constructive. This is a small maintainer-led project; clear, kind communication helps everyone.

## Questions

Open a [GitHub issue](https://github.com/tonythethompson/Olive-Studio/issues) for bugs or feature discussion. For Microsoft Olive engine behavior, see the [official Olive repository](https://github.com/microsoft/Olive) and docs.
