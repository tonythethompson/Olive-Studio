# Implementation Plan: macOS Unsigned Release & CoreML Execution Provider

## Overview

This plan integrates CoreML as a fully-functional execution provider in Olive Studio across detection, recommendation, validation, venv capability, MCP knowledge base, and provider card UI. A secondary track adds unsigned-DMG documentation for macOS releases. All changes are additive, following established patterns from QNN, OpenVINO, and CUDA providers.

## Tasks

- [x] 1. CoreML Detection & Recommendation
  - [x] 1.1 Detect CoreML through the default ORT runtime in `src/lib/hardwareProbe.ts`
    - Map `CoreMLExecutionProvider` only when it is present in `onnxRuntimeProviders`
    - Do not add CoreML from an Apple Silicon hardware-only signal
    - Keep platform-local recipe selectability separate from local detection
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 1.2 Insert `CoreMLExecutionProvider` into `pickRecommendedProvider()` priority list in `src/lib/hardwareProbe.ts`
    - Place between `OpenVINOExecutionProvider` (conditional) and `WebGpuExecutionProvider`
    - Verify CoreML sits above CPU but below all GPU-accelerated and OpenVINO providers
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 1.3 Write property tests for CoreML detection and recommendation
    - **Property 1: CoreML is not soft-detected from Apple hardware**
    - **Property 2: CoreML requires a default ORT provider report**
    - **Property 3: ORT-listed CoreML is detected**
    - **Property 4: CoreML recommended over CPU without GPU providers**
    - **Property 5: GPU providers recommended over CoreML**
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2**

- [x] 2. CoreML Pipeline Validation — Quantization & PEFT Rules
  - [x] 2.1 Update `isQuantMethodAllowed()` in `src/lib/pipelineStateCommit.ts`
    - Add `CoreMLExecutionProvider` to the `hqq`, `rtn`, `kquant` allowlist (alongside CPU and CUDA)
    - AWQ/GPTQ/SpinQuant/QuaRot already blocked via `GPU_PROVIDERS` — verify no change needed
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.2 Update `isPeftMethodAllowed()` in `src/lib/pipelineStateCommit.ts`
    - Keep QLoRA limited to the existing CUDA/ROCm-capable provider set
    - Preserve LoRA and disable base quantization when LoRA cannot be promoted to QLoRA
    - Verify `isPeftAllowed()` already returns true for CoreML (not in `PEFT_UNSUPPORTED_PROVIDERS`)
    - _Requirements: 5.6, 5.7_

  - [x] 2.3 Write property tests for CoreML validation rules
    - **Property 6: CoreML blocks GPU-only quantization methods**
    - **Property 7: CoreML auto-coerces blocked quantization methods**
    - **Property 8: CoreML allows CPU-compatible quantization and fine-tuning methods**
    - **Validates: Requirements 4.1–4.5, 5.1–5.7**

- [x] 3. Checkpoint — Detection and Validation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. CoreML Venv Capability
  - [x] 4.1 Create `src/server/services/olive/coreml.ts` with `ensureCoremltools()` function
    - Import `getVenvPython` from `../venv/paths.ts`
    - Check if `coremltools` already installed via `pip show coremltools` (idempotent skip)
    - If not installed, run `pip install coremltools` with streaming output to `onLine`
    - Return `{ ok: true }` or `{ ok: false, error: string }` on failure
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.2 Wire CoreML case in `installCapabilityPackages()` in `src/server/services/venv/capabilityEnsure.ts`
    - Replace the `CoreMLExecutionProvider` no-op case (`return { ok: true }`) with a call to `ensureCoremltools(onLine)`
    - Import `ensureCoremltools` from `../olive/coreml.ts`
    - _Requirements: 6.1, 6.2_

  - [x] 4.3 Write unit tests for `ensureCoremltools()` in `src/server/services/olive/coreml.test.ts`
    - Test idempotent skip when already installed
    - Test successful install path
    - Test error propagation on pip failure
    - _Requirements: 6.3, 6.4_

- [x] 5. MCP Knowledge Base Updates
  - [x] 5.1 Add CoreML entry to `olive-mcp-server/olive_mcp_server/knowledge_base/hardware_profiles.json`
    - Include id, name, ort_provider, platform constraint (macOS arm64), compatible_passes, incompatible_passes, and notes
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 5.2 Update `olive-mcp-server/olive_mcp_server/knowledge_base/passes.json` with CoreML provider references
    - Add `CoreMLExecutionProvider` to compatible_providers for: OnnxConversion, OnnxStaticQuantization, OnnxDynamicQuantization, OnnxRtnQuantization, OnnxKquantQuantization, OnnxQatQuantization, OnnxHqqQuantization, LoRA
    - Ensure `CoreMLExecutionProvider` is NOT in: OnnxAwqQuantization, OnnxGptqQuantization, OnnxSpinQuantQuantization, OnnxQuaRotQuantization, QLoRA
    - _Requirements: 8.1, 8.2_

  - [x] 5.3 Write pytest tests for CoreML MCP knowledge base entries
    - **Property 9: MCP passes.json includes CoreML for compatible passes**
    - **Property 10: MCP passes.json excludes CoreML for GPU-only passes**
    - Validate hardware_profiles.json schema for the new entry
    - **Validates: Requirements 7.1–7.3, 8.1, 8.2**

- [x] 6. Provider Card & Documentation
  - [x] 6.1 Update CoreML `tooltip` in `src/lib/providerCatalog.ts`
    - Change `requirements` to: "macOS Apple Silicon (M1/M2/M3/M4). Prefer fixed input shapes for optimal ANE scheduling."
    - Change `quantMethods` to: "PTQ INT8, FP16. KQuant, RTN, HQQ, QAT also supported."
    - Change `recommendation` to: "Suitable for Apple edge deployment. Fixed input shapes enable optimal Neural Engine scheduling. Execute Live requires Darwin host with ORT CoreML EP."
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 6.2 Add unsigned macOS DMG installation section to `README.md`
    - Add a "macOS Installation (Unsigned DMG)" heading with right-click Open instructions
    - Do NOT include `xattr -cr` commands or signing workarounds
    - _Requirements: 1.2, 1.4_

- [x] 7. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The `@` alias resolves to `src/` in all vitest configs — use direct module paths in test imports
- Never trigger actual Olive execution in tests — only test recipe building, validation logic, and JSON export
- Push the branch for CI verification rather than running full test suites locally
- The CoreML detection reuses the same soft-detection pattern as QNN (`hasQnnCompatibleHardware`) and OpenVINO (`hasOpenVinoCompatibleHardware`)
- Validation changes piggyback on the existing `GPU_PROVIDERS` exclusion — AWQ/GPTQ/SpinQuant/QuaRot blocking requires no new rules
- The venv capability follows the same pattern as `ensureOpenVino()` and `ensureOnnxRuntimeGpu()` — new file, import into capabilityEnsure switch
- MCP knowledge base JSON files are consumed by FastMCP tools; keep entries consistent with existing schema

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1", "6.2"] },
    { "id": 1, "tasks": ["1.2", "2.2", "4.1", "5.2", "6.1"] },
    { "id": 2, "tasks": ["1.3", "2.3", "4.2", "5.3"] },
    { "id": 3, "tasks": ["4.3"] }
  ]
}
```
