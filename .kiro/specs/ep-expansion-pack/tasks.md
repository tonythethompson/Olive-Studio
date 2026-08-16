# Implementation Plan: EP Expansion Pack

## Overview

This plan implements 5 workstreams to expand Olive Studio's execution provider coverage: MIGraphX (AMD Instinct), oneDNN (Intel CPU), QNN ABI unification (Qualcomm Snapdragon), ROCm RX 9xxx polish (consumer GPU), and cross-cutting exhaustive switch coverage. Tasks are ordered by dependency — type union first (since all other layers depend on it), then metadata/classification, then detection/validation/recipe, then server-side, then MCP knowledge base, then UI, then testing.

## Tasks

- [x] 1. Type union and exhaustive switch foundation
  - [x] 1.1 Add `MIGraphXExecutionProvider` and `DnnlExecutionProvider` to IHVProvider union in `src/types.ts`
    - Add both literals to the `IHVProvider` type union
    - This will trigger exhaustive-switch compile errors in all files that pattern-match on `IHVProvider`
    - _Requirements: 1.1, 5.1, 16.1_

  - [x] 1.2 Update `getProviderRuntimeKind()` in `src/lib/providerRuntimeKind.ts`
    - Add case for `MIGraphXExecutionProvider` returning `"local"`
    - Add case for `DnnlExecutionProvider` returning `"local"`
    - _Requirements: 2.1, 6.1, 16.2_

  - [x] 1.3 Update `mandatoryFamilyForProvider()` and related exports in `src/lib/venvFamily.ts`
    - MIGraphXExecutionProvider: return `"default"` from `mandatoryFamilyForProvider()`
    - DnnlExecutionProvider: return `null` (no mandatory family)
    - Add both to `KNOWN_IHV_PROVIDERS` array and `PROVIDER_ALIASES` map
    - _Requirements: 2.2, 6.2, 16.5_

  - [x] 1.4 Update `isGpuProvider()` in `src/lib/vramEstimate.ts`
    - MIGraphXExecutionProvider: return `true`
    - DnnlExecutionProvider: return `false`
    - _Requirements: 16.6_

  - [x] 1.5 Update `GPU_PROVIDERS` and `providerToAccelerator()` in `src/lib/oliveRecipeBuilder.ts`
    - Add `MIGraphXExecutionProvider` to `GPU_PROVIDERS` array
    - Do NOT add `DnnlExecutionProvider` to `GPU_PROVIDERS` or `NPU_PROVIDERS`
    - Ensure `providerToAccelerator()` maps MIGraphX → `{ device: "gpu", execution_providers: ["MIGraphXExecutionProvider"] }`
    - Ensure `providerToAccelerator()` maps DnnlExecutionProvider → `{ device: "cpu", execution_providers: ["DnnlExecutionProvider"] }`
    - _Requirements: 4.1, 8.1, 16.3_

  - [x] 1.6 Update `ORT_PROVIDER_MAP` in `src/lib/hardwareProbe.ts`
    - Add `"MIGraphXExecutionProvider": "MIGraphXExecutionProvider"` to the map
    - Add `"DnnlExecutionProvider": "DnnlExecutionProvider"` to the map
    - _Requirements: 16.4_

  - [x] 1.7 Fix remaining exhaustive switch cases
    - Update `passParameterValidation.ts` (provider display-name switch)
    - Update `oliveRecipeHub.ts` (provider short-label switch)
    - Update any other files with `const _exhaustive: never = provider` pattern that report errors
    - Verify `tsc --noEmit` reports zero errors for unmatched `never` cases
    - _Requirements: 16.1, 16.7_

- [x] 2. Provider catalog entries
  - [x] 2.1 Add MIGraphX entry to `PROVIDER_CATALOG` in `src/lib/providerCatalog.ts`
    - id: `"MIGraphXExecutionProvider"`, name: `"AMD MIGraphX"`, shortName: `"MIGraphX"` (8 chars)
    - desc: ≤120 chars summarizing AMD Instinct datacenter GPU inference
    - icon: `Layers` (GPU-class Lucide icon consistent with CUDA/ROCm)
    - tooltip.requirements: AMD Instinct MI200+ with ROCm 5.7+
    - tooltip.quantMethods: FP16, INT8
    - tooltip.recommendation: FP16 for max throughput
    - _Requirements: 1.2, 1.3_

  - [x] 2.2 Add DnnlExecutionProvider entry to `PROVIDER_CATALOG` in `src/lib/providerCatalog.ts`
    - id: `"DnnlExecutionProvider"`, name: `"Intel oneDNN (DNNL)"`, shortName: `"oneDNN"` (6 chars)
    - desc: ≤120 chars referencing Intel CPU optimization with AVX-512/AMX
    - icon: `CpuIcon` (CPU-class Lucide icon)
    - tooltip.requirements: Intel CPU with AVX2 min, AVX-512/AMX recommended
    - tooltip.quantMethods: INT8 static quantization, BF16
    - tooltip.recommendation: INT8 static quantization for best throughput
    - _Requirements: 5.2, 5.3_

  - [x] 2.3 Add QnnAbiExecutionProvider entry to `PROVIDER_CATALOG` in `src/lib/providerCatalog.ts`
    - id: `"QnnAbiExecutionProvider"`, name: `"Qualcomm QNN ABI (QairtPipeline)"`, shortName: `"QNN ABI"` (7 chars)
    - desc: Single-pass QairtPipeline direct compilation for Snapdragon NPU
    - tooltip.requirements: Snapdragon 8 Gen 2/3+, Windows ARM64 or x64
    - tooltip.quantMethods: INT4 via QairtPipeline, INT8
    - tooltip.recommendation: Use-case comparison between QNN ABI vs standard QNN
    - _Requirements: 9.1, 10.1, 10.2, 10.3_

  - [x] 2.4 Write property test for catalog schema invariant
    - **Property 1: Provider Catalog Entry Schema Invariant**
    - Verify all entries: shortName ≤ 8 chars, desc ≤ 120 chars, tooltip has non-empty requirements/quantMethods/recommendation
    - Use fast-check to enumerate all `PROVIDER_CATALOG` entries
    - **Validates: Requirements 1.2, 5.2, 9.1**

- [x] 3. Checkpoint - Verify type system compiles
  - Ensure `tsc --noEmit` passes with zero errors. Ask the user if questions arise.

- [x] 4. Validation rules for MIGraphX and oneDNN
  - [x] 4.1 Add MIGraphX conflict rules to `getProviderConflicts()` in `src/lib/pipelineValidation.ts`
    - Critical conflicts: `conversionFormat: "openvino"`, `qairtPipeline: true`, TensorRT-gated passes
    - Warning conflict: `pruningType: "structured"` (advisory about NVIDIA tensor-core requirement)
    - Ensure no conflict for compatible passes: OnnxConversion (onnx format), OnnxFloatToFloat16, OnnxStaticQuantization, OnnxModelOptimizer, AWQ, GPTQ, SpinQuant, QuaRot, HQQ, PEFT
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [x] 4.2 Add oneDNN conflict rules to `getProviderConflicts()` in `src/lib/pipelineValidation.ts`
    - Critical conflicts: `conversionFormat: "openvino"`, `qairtPipeline: true`, `simplifiedLayerNormToRMSNorm: true`, TensorRT-gated passes, `mobiusBuilder: true`
    - Critical conflict: PyTorch-native quant methods (AWQ, GPTQ, HQQ, SpinQuant, QuaRoT) with autofix reverting to PTQ INT8
    - Warning conflict: OnnxFloatToFloat16 without AMX (advisory about BF16 performance)
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 4.3 Add MIGraphX and oneDNN to `PASS_VALIDATIONS` in `src/components/features/ihv/hardwarePassCompatibility.ts`
    - MIGraphX supported passes: OnnxConversion, OnnxFloatToFloat16, OnnxStaticQuantization (PTQ), OnnxModelOptimizer, AWQ, GPTQ, SpinQuant, QuaRot, HQQ
    - oneDNN supported passes: OnnxConversion, OnnxStaticQuantization (INT8 only), OnnxModelOptimizer, OnnxFloatToFloat16
    - _Requirements: 4.3, 8.3_

  - [x] 4.4 Add ROCm consumer/datacenter validation differentiation
    - Add `isaFamily` optional field to `GpuInfo` interface in the relevant types file
    - In `getProviderConflicts()` or new `validateRocmConsumerHardware()`: check probe's `isaFamily` field
    - RDNA ISA (gfx10, gfx103, gfx11): emit warning about limited consumer support
    - gfx12xx (RDNA 4): emit info about experimental support, recommend GPTQ over AWQ
    - ROCm + AWQ: emit info-severity recommendation to use GPTQ
    - ROCm + structured 2:4 sparsity on non-CDNA: emit critical conflict
    - ROCm + FP16 accumulation on consumer RDNA: emit critical conflict
    - Skip differentiation if `isaFamily` field is missing
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 4.5 Write property tests for MIGraphX conflict detection
    - **Property 4: MIGraphX Incompatible Pass Conflict Detection**
    - Generate random combinations of incompatible passes with MIGraphX provider, assert at least one critical HardwareConflict
    - **Validates: Requirements 4.2**

  - [x] 4.6 Write property tests for MIGraphX compatible pass allowance
    - **Property 5: MIGraphX Compatible Pass Allowance**
    - Generate random subsets of compatible passes with MIGraphX, assert zero HardwareConflict entries
    - **Validates: Requirements 4.3**

  - [x] 4.7 Write property tests for oneDNN conflict detection
    - **Property 6: oneDNN Incompatible Pass Conflict Detection**
    - Generate random combinations of incompatible passes with DnnlExecutionProvider, assert at least one critical conflict
    - **Validates: Requirements 8.2**

  - [x] 4.8 Write property test for oneDNN GPU quant method blocking
    - **Property 7: oneDNN GPU Quantization Method Blocking**
    - Generate random PyTorch-native quant methods with DnnlExecutionProvider, assert blocking
    - **Validates: Requirements 8.5**

- [x] 5. QNN ABI auto-coercion and unified UX
  - [x] 5.1 Add QNN ABI selection coercion rules to `AUTO_COERCE_RULES` in `src/lib/pipelineStateCommit.ts`
    - When `QnnAbiExecutionProvider` selected: auto-enable `qairtPipeline: true`, disable `conversion` (onnxConversion), disable `onnxDiscrepancyCheck`, disable incompatible quant passes
    - When `QNNExecutionProvider` selected: auto-disable `qairtPipeline: false`, re-enable `conversion: true`
    - _Requirements: 9.5, 9.6, 9.7_

  - [x] 5.2 Add oneDNN quant method auto-coercion in `src/lib/pipelineStateCommit.ts`
    - When `DnnlExecutionProvider` selected with PyTorch-native quant method: auto-coerce to `"ptq"` (OnnxStaticQuantization INT8)
    - Add corresponding `CROSS_PASS_RULES` entry with `autoCoerce: true`
    - _Requirements: 8.5, 8.6_

  - [x] 5.3 Write property test for QNN ABI coercion invariant
    - **Property 8: QNN ABI Selection Coercion Invariant**
    - Generate random initial pass states, apply QNN ABI selection, assert `qairtPipeline: true`, `conversion: false`, `onnxDiscrepancyCheck: false`
    - **Validates: Requirements 9.5**

  - [x] 5.4 Write property test for QNN plugin inverse coercion
    - **Property 9: QNN Plugin Selection Inverse Coercion**
    - Generate random pass states with `qairtPipeline: true`, apply QNNExecutionProvider selection, assert `qairtPipeline: false`
    - **Validates: Requirements 9.6**

- [x] 6. Checkpoint - Verify validation logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Hardware probe detection extensions
  - [x] 7.1 Extend `HardwareProbeResult` interface with `migraphx` and `dnnl` sections
    - Add `migraphx?: { loadable: boolean; version?: string }` to the probe result type
    - Add `dnnl?: { available: boolean; provider: string }` to the probe result type
    - _Requirements: 3.2, 7.3_

  - [x] 7.2 Implement MIGraphX detection logic in the hardware probe
    - Only populate `migraphx` section when `probe.rocm?.gpus.length >= 1`
    - Check ORT `get_available_providers()` for `"MIGraphXExecutionProvider"` to set `loadable`
    - If rocm section absent or zero GPUs: omit `migraphx` section entirely
    - Include in `detectedProviders` only when loadable is true
    - _Requirements: 3.1, 3.3, 3.5_

  - [x] 7.3 Implement oneDNN detection logic in the hardware probe
    - Populate `dnnl` section when ORT reports `"DnnlExecutionProvider"` in available providers
    - Set `available: true` and `provider: "DnnlExecutionProvider"`
    - When both DNNL and OpenVINO detected: OpenVINO ranks higher in recommendation ordering
    - When only DNNL detected: include as primary Intel recommendation
    - Omit `dnnl` section and exclude from `detectedProviders` if ORT doesn't report it
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 8. Server-side capability ensure
  - [x] 8.1 Add MIGraphX capability install logic in `src/server/services/venv/capabilityEnsure.ts`
    - Platform gate: Linux x86_64 only; return `{ ok: false }` with ROCm requirement message on other platforms
    - Install: `pip install migraphx` into the assigned venv family with 300-second timeout
    - On failure: return `{ ok: false }` with error cause, do not leave partial installs
    - Add case to `installCapabilityPackages()` exhaustive switch
    - _Requirements: 2.3, 2.4, 2.5, 16.1_

  - [x] 8.2 Add DnnlExecutionProvider capability ensure logic in `src/server/services/venv/capabilityEnsure.ts`
    - Skip package installation (return `{ ok: true }` directly)
    - Verify EP availability by checking ORT `get_available_providers()` includes `"DnnlExecutionProvider"` within 10-second timeout
    - If not present: return failure suggesting ORT wheel with DNNL support
    - Do NOT attempt additional package installation or create a separate venv
    - Add case to `installCapabilityPackages()` exhaustive switch
    - _Requirements: 6.3, 6.4, 16.1_

- [x] 9. MCP Knowledge Base additions
  - [x] 9.1 Add AMD Instinct hardware profiles to `olive-mcp-server/olive_mcp_server/knowledge_base/hardware_profiles.json`
    - MI300X: 192 GB, typical_speedup: `"TBD — awaiting vendor benchmark data"`, calibration_size 128, batch 32, ops: [Conv, Gemm, Attention, LayerNormalization, MatMul]
    - MI325X: 256 GB, typical_speedup: `"TBD — awaiting vendor benchmark data"`, calibration_size 128, batch 64
    - MI350X: 288 GB, typical_speedup: `"TBD — awaiting vendor benchmark data (unreleased silicon)"`, calibration_size 128, batch 64
    - MI355X: 288 GB, typical_speedup: `"TBD — awaiting vendor benchmark data (unreleased silicon)"`, calibration_size 128, batch 64
    - All with execution_providers: [MIGraphXExecutionProvider, ROCMExecutionProvider]
    - All with recommended_passes: [OnnxConversion, OnnxFloatToFloat16, OnnxStaticQuantization, OnnxModelOptimizer]
    - All with known_issues: operator subset coverage, custom-op/dynamic-control-flow limitations
    - All with notes: MIGraphX performs graph-level compilation, preferred over ROCm when ops within coverage
    - NOTE: `typical_speedup` is a placeholder. Mark in the JSON with a top-level `_speedup_unverified: true` field on each new profile so future research can identify which profiles need real benchmark data.
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 9.2 Add AMD Radeon RX 9xxx hardware profiles to `olive-mcp-server/olive_mcp_server/knowledge_base/hardware_profiles.json`
    - RX 9070 XT: 16 GB, typical_speedup: `"TBD — awaiting community ROCm benchmarks on RDNA 4"`, calibration 128, batch 8, execution_providers: [ROCMExecutionProvider]
    - RX 9070: 12 GB, typical_speedup: `"TBD — awaiting community ROCm benchmarks on RDNA 4"`, calibration 64, batch 4, execution_providers: [ROCMExecutionProvider]
    - Both with ops_supported: [Conv, Gemm, Attention] minimum
    - Both with known_issues: RDNA 4 experimental ROCm, operator gaps vs CDNA, driver minimum version
    - Both with notes: Consumer Radeon relies on community-maintained ROCm builds, narrower operator coverage than Instinct
    - NOTE: `typical_speedup` is a placeholder. Mark in the JSON with a top-level `_speedup_unverified: true` field on each new profile so future research can identify which profiles need real benchmark data.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 9.3 Add AMD Radeon RX Consumer / ROCm generic profile to `hardware_profiles.json`
    - 16 GB, typical_speedup: `"TBD — awaiting community ROCm benchmarks"`, calibration 64, batch 8, execution_providers: [ROCMExecutionProvider]
    - known_issues: AWQ unsupported on RDNA consumer GPUs
    - NOTE: `typical_speedup` is a placeholder. Mark in the JSON with a top-level `_speedup_unverified: true` field on each new profile so future research can identify which profiles need real benchmark data.
    - _Requirements: 13.4_

  - [x] 9.4 Add Intel Core (oneDNN) hardware profile to `hardware_profiles.json`
    - accelerator: "cpu", execution_providers: [DnnlExecutionProvider, CPUExecutionProvider]
    - typical_speedup: `"TBD — awaiting oneDNN vs bare CPU benchmarks"`
    - recommended_passes: [OnnxConversion, OnnxStaticQuantization, OnnxModelOptimizer]
    - Notes: No additional package installation beyond default ORT wheel
    - known_issues: DNNL availability depends on ORT build variant
    - NOTE: `typical_speedup` is a placeholder. Mark in the JSON with a top-level `_speedup_unverified: true` field on each new profile so future research can identify which profiles need real benchmark data.
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [x] 9.5 Add "AMD Radeon RX Consumer" recipe template to MCP integration_recipes knowledge base
    - Pass sequence: OnnxConversion → GptqQuantizer (bits: 4, group_size: 128) → OnnxModelOptimizer
    - Target: ROCMExecutionProvider, optimal_batch_size: 8
    - Guidance: GPTQ INT4 for LLMs, OnnxFloatToFloat16 for vision models, batch 8-16 for calibration
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 9.6 Add `_speedup_unverified: true` marker to all new hardware profiles
    - Add a top-level boolean field `_speedup_unverified` set to `true` on every new hardware profile added in tasks 9.1-9.4
    - Add a `_data_source` string field set to `"estimated — no official vendor benchmark"` to each new profile
    - These fields flag profiles for future research/validation when real benchmark data becomes available
    - The MCP tools should not surface these markers to users — they serve as internal metadata for maintainers
    - _Requirements: 14.5, 11.5, 15.1_

  - [x] 9.7 Write property test for hardware profile schema completeness
    - **Property 2: Hardware Profile Schema Completeness**
    - Load all profiles from hardware_profiles.json, validate each has all required fields with correct types
    - **Validates: Requirements 11.5, 14.5, 15.1**

  - [x] 9.8 Add EP selection guidance knowledge entry to MCP knowledge base
    - Create a new file `olive-mcp-server/olive_mcp_server/knowledge_base/ep_selection_guidance.json` (or add a section to an existing guidance file)
    - Document the decision tree for when to recommend each EP:
      - **MIGraphX vs ROCm**: Use MIGraphX when targeting AMD Instinct datacenter GPUs and the model's operators are within MIGraphX coverage (standard CNNs, transformers with supported ops). Fall back to ROCm EP when models use custom operators, dynamic control flow, or ops outside MIGraphX's subset. MIGraphX provides graph-level compilation (like TensorRT) for maximum throughput; ROCm is a generic fallback.
      - **oneDNN vs OpenVINO vs CPU**: Use OpenVINO when the full Intel optimization stack is available (recommended for production Intel deployments). Use oneDNN when you want lighter-weight Intel CPU optimization without installing the OpenVINO plugin (bundled in default ORT wheel, zero setup). Use plain CPU EP only as a last resort when neither OpenVINO nor oneDNN is available.
      - **QNN vs QNN ABI**: Use QNN (standard plugin) when you need fine-grained multi-pass control over the optimization pipeline (OnnxConversion → quantization → QNN compilation separately), when integrating with existing multi-step Qualcomm workflows, or when troubleshooting individual pass failures. Use QNN ABI (QairtPipeline) for new Snapdragon projects where you want single-binary deployment — it compiles the model directly to a context binary in one pass, simpler workflow, preferred for fresh greenfield projects targeting Snapdragon 8 Gen 2/3+.
      - **ROCm on consumer Radeon vs Instinct**: Consumer Radeon (RX 6000/7000/9000 RDNA) has limited ROCm support, community-maintained builds, and narrower operator coverage. Prefer GPTQ over AWQ on RDNA. Instinct (MI-series CDNA) has full vendor-supported ROCm stack, MIGraphX graph compilation, and broader operator coverage.
    - This guidance should be queryable by the MCP `recommend_optimization_pipeline` tool or similar assistant-facing tools
    - _Requirements: 13.2, 14.3, 15.4, 10.3_

- [x] 10. Checkpoint - Verify knowledge base and server
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. IHV Panel UI changes
  - [x] 11.1 Add "Qualcomm Snapdragon" grouped section to the IHV provider card grid
    - Group QNNExecutionProvider and QnnAbiExecutionProvider under a shared section heading containing "Qualcomm Snapdragon"
    - QNNExecutionProvider card: badge/subtitle stating "Multi-pass plugin workflow (OnnxConversion → quantization → QNN compilation)"
    - QnnAbiExecutionProvider card: badge/subtitle stating "Single-pass QairtPipeline (direct model-to-context-binary)"
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 11.2 Add IHV panel logic for MIGraphX install-needed indicator
    - When hardware probe detects AMD Instinct GPU but `migraphx.loadable` is false: render provider card with textual install-needed indicator
    - When probe detects no AMD GPUs: do not render MIGraphX card
    - _Requirements: 3.4, 1.3, 1.4_

  - [x] 11.3 Add IHV panel logic for oneDNN unavailable state
    - When hardware probe does not detect AVX2 support: mark oneDNN card as unavailable with reason
    - _Requirements: 5.4_

  - [x] 11.4 Add inline notification for QNN ABI pass coercion
    - When selecting QNN ABI coerces passes off, display transient inline notification (≤200ms appearance) listing disabled passes and rationale
    - _Requirements: 9.7_

  - [x] 11.5 Ensure tooltip visibility behavior for QNN ABI card
    - Tooltip becomes visible within 300ms on hover/focus and remains visible while hover/focus persists
    - _Requirements: 10.4_

- [x] 12. Unit tests for classification and recipe builder
  - [x] 12.1 Write unit tests for provider runtime kind and venv family
    - Test `getProviderRuntimeKind()` returns `"local"` for both new providers
    - Test `mandatoryFamilyForProvider()` returns `"default"` for MIGraphX, `null` for DNNL
    - Test `KNOWN_IHV_PROVIDERS` includes both new providers
    - _Requirements: 2.1, 2.2, 6.1, 6.2, 16.2, 16.5_

  - [x] 12.2 Write unit tests for GPU classification and accelerator mapping
    - Test `isGpuProvider()` returns `true` for MIGraphX, `false` for DNNL
    - Test `providerToAccelerator()` maps MIGraphX → gpu, DNNL → cpu
    - Test `GPU_PROVIDERS` includes MIGraphX and excludes DNNL
    - _Requirements: 4.1, 8.1, 16.3, 16.6_

  - [x] 12.3 Write property test for GPU provider accelerator mapping
    - **Property 3: GPU Provider Accelerator Mapping**
    - For any provider in `GPU_PROVIDERS`: assert `providerToAccelerator()` returns `device: "gpu"`
    - For any provider NOT in `GPU_PROVIDERS` and NOT in `NPU_PROVIDERS`: assert `device: "cpu"`
    - **Validates: Requirements 4.1, 8.1, 16.3**

- [x] 13. Final checkpoint - Verify all tests and compilation
  - Ensure `tsc --noEmit` passes, `pnpm lint` passes, and targeted test files pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each layer is complete
- Property tests validate the 9 correctness properties defined in design.md using fast-check
- The type union (task 1.1) must be completed first — all downstream tasks depend on it
- MCP knowledge base tasks (9.x) are independent of TypeScript code tasks and can run in parallel with tasks 7-8
- UI tasks (11.x) depend on catalog entries (2.x) and validation rules (4.x, 5.x) being complete
- Server-side tasks (8.x) depend on venv family assignment (1.3) and type union (1.1)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 2, "tasks": ["1.7", "2.1", "2.2", "2.3", "9.1", "9.2", "9.3", "9.4", "9.5", "9.8"] },
    { "id": 3, "tasks": ["2.4", "4.1", "4.2", "4.3", "4.4", "7.1", "8.1", "8.2", "9.6", "9.7"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "4.8", "5.1", "5.2", "7.2", "7.3"] },
    { "id": 5, "tasks": ["5.3", "5.4", "11.1", "11.2", "11.3", "11.4", "11.5"] },
    { "id": 6, "tasks": ["12.1", "12.2", "12.3"] }
  ]
}
```
