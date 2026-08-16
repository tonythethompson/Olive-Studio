# Requirements Document

## Introduction

This feature expands Olive Studio's execution provider (EP) coverage by adding two new first-class local EPs (MIGraphX, oneDNN/DNNL), unifying the dual QNN EPs into a coherent UI experience, and polishing the existing ROCm EP with RX 9xxx hardware profiles and consumer/datacenter differentiation. The goal is to provide complete coverage for AMD datacenter (MIGraphX), Intel CPU inference (oneDNN), Qualcomm Snapdragon (unified QNN), and AMD consumer GPU (ROCm RX 9xxx) users.

## Glossary

- **Studio**: The Olive Studio application (React + Express desktop web app).
- **Provider_Catalog**: The `PROVIDER_CATALOG` array in `src/lib/providerCatalog.ts` that defines UI card metadata for each execution provider.
- **Hardware_Probe**: The system that detects available hardware and reports detected execution providers via `HardwareProbeResult`.
- **Venv_Family**: A named Python virtual environment slot (`default`, `cuda`, `openvino`, `qnn`, or new families) managed by the venv orchestrator.
- **Recipe_Builder**: The `buildOliveRecipe` system that converts UIState into an Olive JSON recipe.
- **Validation_Engine**: The pipeline validation system (`pipelineValidation.ts` + `pipelineStateCommit.ts`) that enforces cross-pass compatibility rules.
- **MIGraphX**: AMD's graph-compiled inference engine for AMD Instinct datacenter GPUs (MI300X, MI325X, MI350X, MI355X), analogous to NVIDIA TensorRT.
- **oneDNN**: Intel's oneAPI Deep Neural Network Library providing optimized CPU inference kernels. Often bundled in the default ORT wheel.
- **QNN_Plugin**: The ORT execution provider using Qualcomm's QNN SDK via the standard plugin registration path (`QNNExecutionProvider`).
- **QNN_ABI**: The ORT execution provider using Qualcomm's newer QairtPipeline single-pass ABI workflow (`QnnAbiExecutionProvider`).
- **RDNA_4**: AMD's GPU microarchitecture (gfx12) powering Radeon RX 9000 series consumer GPUs.
- **Instinct**: AMD's datacenter GPU line (MI-series) running full ROCm with MIGraphX support.
- **Pass_Compatibility_Matrix**: The `PASS_VALIDATIONS` array in `hardwarePassCompatibility.ts` defining which optimization passes are supported per provider.
- **MCP_Knowledge_Base**: The JSON files in `olive-mcp-server/olive_mcp_server/knowledge_base/` providing hardware profiles and pass metadata to the MCP tools.
- **IHV_Panel**: The hardware target selection UI panel (`IHVIntegrationPanel`) where users choose their execution provider.

## Requirements

### Requirement 1: MIGraphX Execution Provider Type Registration

**User Story:** As a developer targeting AMD Instinct datacenter GPUs, I want MIGraphX listed as a selectable execution provider, so that I can build optimized inference recipes for MI300X/MI325X/MI350X/MI355X hardware.

#### Acceptance Criteria

1. THE Studio SHALL include `"MIGraphXExecutionProvider"` in the `IHVProvider` type union defined in `src/types.ts`.
2. THE `PROVIDER_CATALOG` array in `src/lib/providerCatalog.ts` SHALL contain a `ProviderCatalogEntry` for `"MIGraphXExecutionProvider"` with `id` set to `"MIGraphXExecutionProvider"`, a `name`, a `shortName` of 8 characters or fewer, a `desc` of 120 characters or fewer summarizing AMD Instinct datacenter GPU inference via MIGraphX, an `icon` set to a GPU-class Lucide icon consistent with other GPU providers, and a `tooltip` object whose `requirements` field specifies minimum hardware (AMD Instinct MI200 series or newer with ROCm 5.7+ stack), whose `quantMethods` field lists FP16 and INT8 as supported quantization methods, and whose `recommendation` field advises on optimal quantization choice for datacenter throughput.
3. WHEN the IHV panel renders the list of available providers, THE Studio SHALL display a selectable card for MIGraphX showing the catalog entry's `name`, `shortName`, `desc`, `icon`, and `tooltip` metadata.
4. IF the `IHVProvider` type union includes `"MIGraphXExecutionProvider"` but no matching entry exists in `PROVIDER_CATALOG`, THEN THE Studio SHALL treat the provider as unavailable and not render a card for it in the IHV panel.

### Requirement 2: MIGraphX Runtime Classification and Venv Family

**User Story:** As a developer, I want MIGraphX to use the correct runtime environment, so that the optimizer can install and invoke MIGraphX without conflicting with other providers.

#### Acceptance Criteria

1. THE Studio SHALL classify MIGraphXExecutionProvider as `local` runtime kind in `providerRuntimeKind.ts`, returning `"local"` from `getProviderRuntimeKind()` for that provider.
2. WHEN `resolveVenvFamily()` resolves the venv family for MIGraphXExecutionProvider, THE Studio SHALL assign it to a `rocm` venv family (shared with ROCMExecutionProvider) OR a dedicated `migraphx` family, where the choice is determined by whether the `migraphx` Python package's ROCm dependency versions conflict with the base ROCm ORT distribution pinned in the shared family spec.
3. WHEN the capability ensure system processes MIGraphXExecutionProvider via `ensureProviderCapability()`, THE Studio SHALL invoke a provider-specific install function that installs the `migraphx` Python package (and its transitive ROCm dependencies) into the assigned venv family, completing within 300 seconds or timing out.
4. IF the MIGraphX package installation fails (non-zero pip exit code or timeout), THEN THE Studio SHALL return `{ ok: false }` with an error message indicating the failure cause (missing ROCm stack, incompatible platform, or network failure) and the venv family that was targeted, without leaving the venv in a partially-installed state that would corrupt subsequent provider capability checks.
5. IF `ensureProviderCapability()` is called for MIGraphXExecutionProvider on a platform other than Linux x86_64 with ROCm support, THEN THE Studio SHALL return `{ ok: false }` with an error message indicating that MIGraphX requires a Linux host with a compatible AMD ROCm stack.

### Requirement 3: MIGraphX Hardware Probe Detection

**User Story:** As a developer with AMD Instinct hardware, I want Studio to detect MIGraphX availability automatically, so that I do not have to manually configure the environment.

#### Acceptance Criteria

1. WHEN the hardware probe runs on a system where `rocm-smi` reports one or more AMD Instinct GPUs AND `onnxruntime.get_available_providers()` includes `"MIGraphXExecutionProvider"`, THE Hardware_Probe SHALL include `"MIGraphXExecutionProvider"` in `detectedProviders`.
2. WHEN the hardware probe runs on a system with AMD Instinct hardware, THE Hardware_Probe SHALL expose a `migraphx` section in the probe result containing a boolean `loadable` field (true when `MIGraphXExecutionProvider` is registered by ORT in the active `.venv`), and an optional `version` string (the MIGraphX library version if resolvable, otherwise omitted).
3. WHEN the probe detects one or more AMD GPUs via the existing `rocm` probe path (i.e. `probe.rocm.gpus.length >= 1`), THE Hardware_Probe SHALL check for `"MIGraphXExecutionProvider"` in ORT's available providers list and set `migraphx.loadable` to true only if that provider string is present.
4. IF the `rocm` probe path detects AMD Instinct GPU hardware but `migraphx.loadable` is false, THEN THE IHV_Panel SHALL render MIGraphX as a selectable provider entry accompanied by a textual install-needed indicator stating that the MIGraphX runtime is not installed in the project `.venv`.
5. IF the `rocm` probe path reports zero AMD GPUs (or the `rocm` section is absent from the probe result), THEN THE Hardware_Probe SHALL omit the `migraphx` section entirely from the probe result and SHALL NOT include `"MIGraphXExecutionProvider"` in `detectedProviders`.

### Requirement 4: MIGraphX Validation and Recipe Builder Support

**User Story:** As a developer, I want the recipe builder and validation engine to correctly handle MIGraphX, so that generated recipes are valid for AMD Instinct targets.

#### Acceptance Criteria

1. WHEN MIGraphXExecutionProvider is selected, THE Recipe_Builder SHALL emit `accelerator: { device: "gpu", execution_providers: ["MIGraphXExecutionProvider"] }` in the recipe's `systems.local_system.config.accelerators` array.
2. WHEN MIGraphXExecutionProvider is selected AND any of OpenVINO IR conversion (`conversionFormat: "openvino"`), QairtPipeline, or TensorRT-specific passes (TensorrtExecutionProvider-gated passes) are enabled, THE Validation_Engine SHALL report a critical-severity hardware conflict for each incompatible pass and auto-coerce by disabling the incompatible pass or reverting its format to ONNX.
3. WHEN MIGraphXExecutionProvider is selected, THE Validation_Engine SHALL permit the following passes without raising conflicts: OnnxConversion (format "onnx"), OnnxFloatToFloat16, OnnxStaticQuantization (PTQ), OnnxModelOptimizer, AWQ, GPTQ, SpinQuant, QuaRot, and HQQ quantization methods.
4. WHEN MIGraphXExecutionProvider is selected AND the user enables PEFT passes (LoRA or QLoRA), THE Validation_Engine SHALL allow PEFT without raising a conflict, returning no hardware conflict entry for the `peft` or `peftMethod` pass keys.
5. IF MIGraphXExecutionProvider is selected AND structured pruning (`pruningType: "structured"`) is enabled, THEN THE Validation_Engine SHALL report a warning-severity conflict, because structured 2:4 sparsity requires NVIDIA tensor-core hardware not available on AMD Instinct GPUs.

### Requirement 5: oneDNN (DNNL) Execution Provider Type Registration

**User Story:** As a developer targeting Intel CPUs, I want oneDNN/DNNL listed as a selectable execution provider, so that I can leverage hardware-optimized CPU kernels beyond the default CPU EP.

#### Acceptance Criteria

1. THE Studio SHALL include `"DnnlExecutionProvider"` in the `IHVProvider` type union defined in `src/types.ts`.
2. THE `PROVIDER_CATALOG` array in `src/lib/providerCatalog.ts` SHALL contain a `ProviderCatalogEntry` for `"DnnlExecutionProvider"` with `name` set to `"Intel oneDNN (DNNL)"`, `shortName` set to `"oneDNN"`, `desc` referencing Intel CPU optimization with AVX-512/AMX instruction sets, `icon` set to the `CpuIcon` Lucide icon, and a `tooltip` object whose `requirements` field states the minimum hardware as Intel CPU with AVX2 and recommended hardware as AVX-512/AMX, whose `quantMethods` field lists INT8 static quantization and BF16, and whose `recommendation` field advises using INT8 static quantization for best oneDNN throughput.
3. WHEN the IHV panel renders the list of available providers, THE Studio SHALL display a selectable card for oneDNN showing the catalog entry's `name`, `shortName`, `desc`, `icon`, and `tooltip` metadata from the `PROVIDER_CATALOG` entry.
4. IF the hardware probe does not detect AVX2 support on the host CPU, THEN THE Studio SHALL mark the oneDNN provider card as unavailable and display a reason indicating that AVX2 is the minimum required instruction set.

### Requirement 6: oneDNN Runtime Classification and Venv Handling

**User Story:** As a developer, I want oneDNN to work without a separate venv installation step when it is bundled in the default ORT wheel, so that setup is frictionless.

#### Acceptance Criteria

1. THE Studio SHALL classify DnnlExecutionProvider as `local` runtime kind in `providerRuntimeKind.ts`, placing it alongside other providers (such as CPUExecutionProvider and CUDAExecutionProvider) that can run via local Olive Python when the probe and venv allow.
2. THE Venv Family resolver (`resolveVenvFamily` in `venvFamily.ts`) SHALL assign DnnlExecutionProvider to the `default` venv family by returning `null` from `mandatoryFamilyForProvider`, so that no dedicated venv (cuda, openvino, qnn) is provisioned for oneDNN.
3. WHEN the capability ensure system (`ensureProviderCapability`) processes DnnlExecutionProvider, THE Studio SHALL skip additional package installation (return `{ ok: true }` from `installCapabilityPackages`) and verify EP availability by checking that `"DnnlExecutionProvider"` is present in the list returned by `onnxruntime.get_available_providers()` in the family venv's Python within 10 seconds (the existing ORT probe timeout).
4. IF DnnlExecutionProvider is not present in the `onnxruntime.get_available_providers()` list despite the host platform being Intel x86_64, THEN THE Studio SHALL return a failure result with an error message indicating that the installed ORT wheel may not include DNNL support and suggesting reinstallation of an ORT build with oneDNN enabled, and SHALL NOT attempt to install additional packages or create a separate venv.

### Requirement 7: oneDNN Hardware Probe Detection

**User Story:** As a developer with an Intel CPU supporting AVX-512 or AMX, I want Studio to detect oneDNN availability automatically, so that I can select it as a lightweight alternative to OpenVINO.

#### Acceptance Criteria

1. WHEN the hardware probe runs on a system where ORT reports `DnnlExecutionProvider` in available providers, THE Hardware_Probe SHALL include `"DnnlExecutionProvider"` in `detectedProviders`.
2. IF ORT does not report `DnnlExecutionProvider` in available providers, THEN THE Hardware_Probe SHALL omit the `dnnl` section from the probe result and SHALL NOT include `"DnnlExecutionProvider"` in `detectedProviders`.
3. WHEN DnnlExecutionProvider is detected, THE Hardware_Probe SHALL add a `dnnl` section to the probe result containing at minimum an `available` boolean field set to `true` and a `provider` string field set to `"DnnlExecutionProvider"`.
4. WHEN both DnnlExecutionProvider and OpenVINOExecutionProvider are detected, THE Hardware_Probe SHALL assign OpenVINOExecutionProvider a higher recommendation rank than DnnlExecutionProvider in the provider ordering of the probe result.
5. WHEN DnnlExecutionProvider is detected and OpenVINOExecutionProvider is not detected, THE Hardware_Probe SHALL include DnnlExecutionProvider in the recommended providers list as the primary Intel execution provider.

### Requirement 8: oneDNN Validation and Recipe Builder Support

**User Story:** As a developer, I want the recipe builder and validation engine to correctly handle oneDNN, so that generated recipes use appropriate passes for Intel CPU optimization.

#### Acceptance Criteria

1. THE Recipe_Builder SHALL map DnnlExecutionProvider to `device: "cpu"` with `execution_providers: ["DnnlExecutionProvider"]` in the accelerator config produced by `providerToAccelerator()`.
2. WHEN DnnlExecutionProvider is selected and any of the following passes are enabled — OpenVINO IR conversion, QairtPipeline, SimplifiedLayerNormToRMSNorm, TensorRT-targeted passes, or MobiusBuilder — THEN THE Validation_Engine SHALL report a critical-severity conflict for each incompatible pass and provide an autofix that disables the incompatible pass.
3. THE Pass_Compatibility_Matrix SHALL define oneDNN-supported passes as: OnnxConversion, OnnxStaticQuantization (INT8 precision only), OnnxModelOptimizer, and OnnxFloatToFloat16.
4. IF OnnxFloatToFloat16 is enabled with DnnlExecutionProvider and the hardware probe does not report AMX capability, THEN THE Validation_Engine SHALL report a warning-severity issue indicating BF16 performance will be degraded without AMX instruction support.
5. WHEN DnnlExecutionProvider is selected, THE Validation_Engine SHALL report a critical-severity conflict and block recipe generation if any PyTorch-native GPU quantization method (AWQ, GPTQ, HQQ, SpinQuant, or QuaRoT) is selected, with an autofix that reverts the quantization method to OnnxStaticQuantization INT8.
6. WHEN DnnlExecutionProvider is selected and a user enables an incompatible pass, THE Validation_Engine SHALL auto-coerce by disabling the incompatible pass during `commitUiStateUpdate()` if the corresponding `CROSS_PASS_RULES` entry has `autoCoerce: true`, or display the conflict in the validation panel if `autoCoerce: false`.

### Requirement 9: Unified QNN EP User Experience

**User Story:** As a developer targeting Qualcomm Snapdragon NPUs, I want a coherent UI that presents the QNN plugin path and QNN ABI path as a unified Qualcomm story, so that I can choose the right workflow without confusion.

#### Acceptance Criteria

1. THE Provider_Catalog SHALL contain an entry for QnnAbiExecutionProvider with name "Qualcomm QNN ABI (QairtPipeline)", shortName "QNN ABI", and a description that states the single-pass direct-compilation workflow in contrast to the multi-pass QNN plugin workflow.
2. WHEN the IHV_Panel renders QNN-related providers, THE Studio SHALL present both QNNExecutionProvider and QnnAbiExecutionProvider as labeled cards within a shared "Qualcomm Snapdragon" section demarcated by a section heading containing the text "Qualcomm Snapdragon".
3. THE QNNExecutionProvider card SHALL display a subtitle or badge text stating it uses the multi-pass plugin workflow (OnnxConversion → quantization → QNN compilation).
4. THE QnnAbiExecutionProvider card SHALL display a subtitle or badge text stating it uses the single-pass QairtPipeline workflow (direct model-to-context-binary compilation).
5. WHEN the user selects QnnAbiExecutionProvider, THE Validation_Engine SHALL auto-enable the qairtPipeline pass, disable the onnxConversion pass, disable any quantization passes that are incompatible with QairtPipeline, and disable the onnxDiscrepancyCheck pass.
6. WHEN the user selects QNNExecutionProvider, THE Validation_Engine SHALL disable the qairtPipeline pass and enable OnnxConversion plus any quantization passes that were previously coerced off by criterion 5.
7. IF the user selects QnnAbiExecutionProvider while incompatible passes are currently enabled, THEN THE Validation_Engine SHALL coerce those passes off and THE Studio SHALL display an inline notification within 200ms identifying which passes were disabled and why.

### Requirement 10: QNN ABI Tooltip and Guidance

**User Story:** As a developer unfamiliar with Qualcomm toolchains, I want clear guidance on when to use QNN ABI vs standard QNN, so that I can make an informed choice.

#### Acceptance Criteria

1. THE QnnAbiExecutionProvider catalog entry tooltip SHALL state the following hardware requirements: Snapdragon 8 Gen 2, Snapdragon 8 Gen 3, or newer SoC; Windows ARM64 for on-device NPU inference; Windows x64 for ahead-of-time context-binary preparation.
2. THE QnnAbiExecutionProvider catalog entry tooltip SHALL state the supported quantization levels: INT4 via QairtPipeline built-in quantization and INT8.
3. THE QnnAbiExecutionProvider catalog entry tooltip SHALL present a use-case comparison stating that QNN ABI is suited for new Snapdragon projects that package model and runtime into a single deployable context binary, while standard QNN is suited for existing pipelines that require individual pass configuration or mixed-pass optimization workflows.
4. WHEN the user hovers over or focuses the QnnAbiExecutionProvider catalog entry, THE tooltip SHALL become visible within 300 ms and remain visible while hover or focus persists.

### Requirement 11: ROCm RX 9xxx Hardware Profile in MCP Knowledge Base

**User Story:** As a developer with an AMD Radeon RX 9070 or RX 9070 XT, I want the MCP knowledge base to include hardware profiles for these GPUs, so that the AI assistant can recommend appropriate optimization recipes.

#### Acceptance Criteria

1. THE MCP_Knowledge_Base SHALL include a hardware profile for "AMD Radeon RX 9070 XT" with accelerator "gpu", execution_providers ["ROCMExecutionProvider"], memory_gb 16, typical_speedup "3-6x", recommended_passes including OnnxConversion, OnnxFloatToFloat16, and GPTQ quantization, calibration_size 128, optimal_batch_size 8, and ops_supported including at minimum ["Conv", "Gemm", "Attention"].
2. THE MCP_Knowledge_Base SHALL include a hardware profile for "AMD Radeon RX 9070" with accelerator "gpu", execution_providers ["ROCMExecutionProvider"], memory_gb 12, typical_speedup "3-6x", recommended_passes including OnnxConversion, OnnxFloatToFloat16, and GPTQ quantization, calibration_size 64, optimal_batch_size 4, and ops_supported including at minimum ["Conv", "Gemm", "Attention"].
3. THE MCP_Knowledge_Base hardware profiles for RX 9xxx SHALL each include a known_issues array containing at least one entry documenting that RDNA 4 (gfx12) architecture has experimental ROCm support status, at least one entry identifying operator coverage gaps relative to CDNA-based Instinct GPUs, and at least one entry noting that ROCm driver versions below a stated minimum version may produce incorrect results or fail to load models.
4. THE MCP_Knowledge_Base hardware profiles for RX 9xxx SHALL each include a notes field that states the profile applies to consumer Radeon GPUs which rely on community-maintained ROCm builds and have narrower operator coverage than datacenter AMD Instinct GPUs that ship with the vendor-supported ROCm stack and MIGraphX provider.
5. IF a hardware profile for an RX 9xxx GPU is queried by the MCP tool, THEN the MCP_Knowledge_Base SHALL return a valid profile object containing all required schema fields: target, accelerator, execution_providers, recommended_passes, typical_speedup, calibration_size, optimal_batch_size, memory_gb, ops_supported, known_issues, and notes.

### Requirement 12: ROCm Consumer vs Datacenter Validation Rules

**User Story:** As a developer, I want the validation engine to differentiate between consumer Radeon and datacenter Instinct GPUs, so that recipes are appropriate for the actual hardware capability.

#### Acceptance Criteria

1. WHEN ROCMExecutionProvider is selected AND the hardware probe detects an RDNA-architecture GPU (consumer Radeon, identified by a GpuInfo field indicating an RDNA ISA family such as gfx10, gfx103, or gfx11), THE Validation_Engine SHALL emit a PipelineIssue with severity "warning" stating that ROCm support on consumer RDNA GPUs is limited and some passes may fail at runtime.
2. WHEN ROCMExecutionProvider is selected AND the hardware probe detects a GPU with ISA identifier in the gfx12xx range (RDNA 4), THE Validation_Engine SHALL emit a PipelineIssue with severity "info" stating that RDNA 4 ROCm support is experimental and recommending GPTQ over AWQ due to known AWQ compatibility gaps on RDNA architectures.
3. WHEN ROCMExecutionProvider is selected AND quantization is enabled, THE Validation_Engine SHALL allow AWQ quantization without blocking the recipe but SHALL include in the validation output a recommendation to use GPTQ for AMD GPUs, citing better ROCm operator coverage.
4. IF ROCMExecutionProvider is selected AND the hardware probe does not report a GpuInfo architecture field (probe predates the RDNA/CDNA classifier or the field is undefined), THEN THE Validation_Engine SHALL skip the consumer-vs-datacenter differentiation and fall back to the existing provider-level ROCm validation rules without emitting the RDNA-specific warnings from criteria 1 and 2.
5. THE getProviderConflicts function SHALL include ROCm-specific entries that reflect reduced operator coverage compared to CUDA, specifically noting that mixed-precision passes (FP16 accumulation) are unsupported on consumer RDNA cards and that structured 2:4 sparsity is unavailable on non-CDNA architectures.

### Requirement 13: ROCm Recipe Templates for Consumer GPUs

**User Story:** As a developer with a consumer AMD GPU, I want recipe presets tuned for Radeon RX hardware, so that I get working optimization pipelines without trial and error.

#### Acceptance Criteria

1. THE MCP_Knowledge_Base SHALL include recipe guidance for consumer ROCm targets (Radeon RX 7000/6000 series with 12-16 GB VRAM) recommending: GPTQ INT4 (group_size 128) for LLMs over AWQ, OnnxFloatToFloat16 for vision models, and batch sizes between 8 and 16 for calibration due to VRAM constraints on 12-16 GB cards.
2. WHEN the AI assistant suggests an optimization pipeline for a ROCm target with a detected consumer GPU (identified by a hardware profile where memory_gb is 16 or less and target contains "Radeon RX"), THE Assistant SHALL prefer GPTQ quantization and include a warning message indicating that AWQ has limited support on RDNA architectures and may produce incorrect results.
3. THE MCP_Knowledge_Base SHALL include a recipe template for "AMD Radeon RX Consumer" in the integration_recipes knowledge base file that specifies OnnxConversion → GptqQuantizer (bits: 4, group_size: 128) → OnnxModelOptimizer as the default pass sequence, targets ROCMExecutionProvider, and sets optimal_batch_size to 8.
4. THE MCP_Knowledge_Base SHALL include a hardware profile entry for "AMD Radeon RX Consumer / ROCm" with accelerator "gpu", execution_providers containing "ROCMExecutionProvider", memory_gb of 16, optimal_batch_size of 8, and a known_issues entry indicating that AWQ is unsupported on RDNA consumer GPUs.
5. IF a user selects the "AMD Radeon RX Consumer" recipe template for a model exceeding 7 billion parameters, THEN THE Assistant SHALL display a warning message indicating that models above 7B parameters may not fit in 16 GB VRAM with GPTQ INT4 quantization and recommending a smaller model or lower group_size.

### Requirement 14: MIGraphX MCP Knowledge Base Integration

**User Story:** As a developer using the AI assistant, I want MIGraphX hardware profiles and pass knowledge available in the MCP knowledge base, so that the assistant can recommend MIGraphX-optimized recipes.

#### Acceptance Criteria

1. THE MCP_Knowledge_Base SHALL include hardware profiles for AMD Instinct MI300X (192 GB HBM3, 1.3 PFLOPS FP16), MI325X (256 GB HBM3e), MI350X, and MI355X, each listing both MIGraphXExecutionProvider and ROCMExecutionProvider as execution_providers, and each profile SHALL include the schema-required fields: memory_gb, typical_speedup, calibration_size (minimum 128 samples), optimal_batch_size, and ops_supported (at minimum: Conv, Gemm, Attention, LayerNormalization, MatMul).
2. THE MCP_Knowledge_Base hardware profiles for Instinct GPUs SHALL include recommended_passes in this order: OnnxConversion, OnnxFloatToFloat16, OnnxStaticQuantization (INT8 calibration), and OnnxModelOptimizer (for MIGraphX-compatible graph-level folding and fusion), with no reference to passes that are not defined in the MCP pass catalog.
3. THE MCP_Knowledge_Base SHALL include a notes field for each Instinct profile stating that MIGraphXExecutionProvider performs graph-level compilation and fusion (similar in role to TensorrtExecutionProvider) and is the preferred EP over ROCMExecutionProvider when the model's operators are within MIGraphX coverage.
4. THE MCP_Knowledge_Base SHALL include a known_issues array for each Instinct profile documenting: (a) MIGraphXExecutionProvider operator coverage is a subset of the full ONNX operator spec — unsupported operators fall back to ROCMExecutionProvider or CPUExecutionProvider, and (b) models relying heavily on custom operators, dynamic control flow, or sequence-length-dependent branching may not benefit from MIGraphX graph compilation.
5. IF an Instinct hardware profile is missing any schema-required field (memory_gb, execution_providers, recommended_passes, typical_speedup, calibration_size, optimal_batch_size, ops_supported, known_issues, or notes), THEN THE MCP_Knowledge_Base validation SHALL report the profile as incomplete and exclude it from assistant recommendations until all fields are populated.

### Requirement 15: oneDNN MCP Knowledge Base Integration

**User Story:** As a developer using the AI assistant, I want oneDNN hardware profiles in the MCP knowledge base, so that the assistant can recommend oneDNN when appropriate for Intel CPU targets.

#### Acceptance Criteria

1. THE MCP_Knowledge_Base SHALL include a hardware profile with target "Intel Core (oneDNN)", accelerator "cpu", execution_providers ["DnnlExecutionProvider", "CPUExecutionProvider"], recommended_passes ["OnnxConversion", "OnnxStaticQuantization", "OnnxModelOptimizer"], and all mandatory schema fields (typical_speedup, calibration_size, optimal_batch_size, memory_gb, ops_supported) populated with values consistent with the existing hardware_profiles.json schema.
2. THE MCP_Knowledge_Base SHALL include notes for the oneDNN profile indicating that oneDNN requires no additional package installation beyond the default ONNX Runtime wheel (unlike OpenVINO which requires a separate plugin), and is suited for Intel CPU inference workloads where only the CPUExecutionProvider fallback and DNNL graph-optimization kernels are needed without OpenVINO IR conversion.
3. THE MCP_Knowledge_Base hardware profile for oneDNN SHALL include a known_issues entry stating that DnnlExecutionProvider availability depends on the ORT build variant, is present in the default onnxruntime pip wheel but absent from onnxruntime-gpu and platform-specific builds that strip CPU-only EPs.
4. WHEN the MCP assistant identifies an Intel CPU target without OpenVINO installed, THE MCP_Knowledge_Base SHALL provide the oneDNN profile as a recommendation distinct from the existing "Intel Core i9 CPU" profile, which requires OpenVINOExecutionProvider.

### Requirement 16: Exhaustive Switch Coverage

**User Story:** As a maintainer, I want all TypeScript exhaustive switch statements to remain complete after adding new providers, so that the codebase compiles without errors.

#### Acceptance Criteria

1. WHEN MIGraphXExecutionProvider and DnnlExecutionProvider are added to the `IHVProvider` union in `src/types.ts`, THE Studio SHALL update all exhaustive `switch` statements that use a `const _exhaustive: never = provider` pattern, including at minimum: `providerRuntimeKind.ts` (`getProviderRuntimeKind`), `venvFamily.ts` (`mandatoryFamilyForProvider`), `capabilityEnsure.ts` (`installCapabilityPackages`), `vramEstimate.ts` (`isGpuProvider`), `passParameterValidation.ts` (provider display-name switch), and `oliveRecipeHub.ts` (provider short-label switch), so that `tsc --noEmit` reports zero errors attributable to unmatched `never` cases.
2. WHEN MIGraphXExecutionProvider and DnnlExecutionProvider are added to the `IHVProvider` union, THE Studio SHALL assign each provider a `ProviderRuntimeKind` in `getProviderRuntimeKind()`: MIGraphXExecutionProvider SHALL return `"local"` (AMD GPU EP installable via pip); DnnlExecutionProvider SHALL return `"local"` (Intel CPU-optimized EP installable via pip).
3. WHEN MIGraphXExecutionProvider and DnnlExecutionProvider are added to the `IHVProvider` union, THE Studio SHALL include MIGraphXExecutionProvider in the `GPU_PROVIDERS` array in `oliveRecipeBuilder.ts` (AMD GPU accelerator) and SHALL NOT include DnnlExecutionProvider in either `GPU_PROVIDERS` or `NPU_PROVIDERS` (oneDNN is a CPU-only EP), so that the accelerator device derivation in `buildAcceleratorConfig()` maps MIGraphX to `"gpu"` and oneDNN to `"cpu"`.
4. WHEN MIGraphXExecutionProvider and DnnlExecutionProvider are added to the `IHVProvider` union, THE Studio SHALL include both providers in the `ORT_PROVIDER_MAP` in `hardwareProbe.ts` with keys matching the ORT-reported string (e.g., `"MIGraphXExecutionProvider"` and `"DnnlExecutionProvider"`) mapped to their respective `IHVProvider` literal values, so that `mapOrtProvidersToIhv()` recognises them from hardware probe results.
5. WHEN MIGraphXExecutionProvider and DnnlExecutionProvider are added to the `IHVProvider` union, THE Studio SHALL add both providers to the `KNOWN_IHV_PROVIDERS` array and `PROVIDER_ALIASES` map in `venvFamily.ts`, and SHALL assign a `VenvFamily` in `mandatoryFamilyForProvider()`: MIGraphXExecutionProvider SHALL return `"default"` (no dedicated venv family today); DnnlExecutionProvider SHALL return `null` (CPU-class, no mandatory family).
6. WHEN MIGraphXExecutionProvider and DnnlExecutionProvider are added to the `IHVProvider` union, THE Studio SHALL assign each provider a GPU classification in `isGpuProvider()` within `vramEstimate.ts`: MIGraphXExecutionProvider SHALL return `true`; DnnlExecutionProvider SHALL return `false`.
7. IF `tsc --noEmit` produces any error referencing an unmatched `never` exhaustiveness case for `IHVProvider` after the addition, THEN THE Studio build SHALL be considered failing and the PR SHALL NOT merge until all such errors are resolved to zero.
