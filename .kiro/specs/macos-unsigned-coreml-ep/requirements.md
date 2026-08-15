# Requirements Document

## Introduction

This feature addresses two complementary goals for Olive Studio's macOS story: (1) shipping unsigned macOS DMG releases with proper user-facing disclaimers, and (2) promoting CoreML from a passive type/catalog entry to a fully-integrated execution provider with soft-detection, recommendation priority, pipeline validation rules, venv wiring, MCP knowledge base entries, and provider card context.

## Glossary

- **Studio**: The Olive Studio application (React + Express + optional Tauri shell)
- **Release_Pipeline**: The GitHub Actions CI/CD workflow that builds, signs, and publishes release artifacts
- **CoreML_EP**: The `CoreMLExecutionProvider` ONNX Runtime execution provider targeting Apple Neural Engine and Apple GPU
- **Detection_Service**: The `mergeDetectedProviders()` function in `src/lib/hardwareProbe.ts` that assembles the list of detected execution providers from hardware and runtime probes
- **Recommendation_Service**: The `pickRecommendedProvider()` function that selects the highest-priority detected provider for auto-selection
- **Validation_Engine**: The `CROSS_PASS_RULES` array and `AUTO_COERCE_RULES` in `pipelineValidation.ts` / `pipelineStateCommit.ts` that enforce pass compatibility
- **Venv_Service**: The venv orchestration layer (`src/server/services/venv/`) that ensures provider-specific Python packages are installed
- **MCP_Knowledge_Base**: The JSON knowledge files in `olive-mcp-server/olive_mcp_server/knowledge_base/` consumed by MCP tools
- **Provider_Card**: The UI card in the IHV Integration Panel that displays provider details, hardware context, and compatibility information
- **Quantization_Method**: A model quantization technique (AWQ, GPTQ, SpinQuant, QuaRot, PTQ, RTN, KQuant, QAT, HQQ)
- **Platform_Local_Provider**: An execution provider classified as `platformLocal` in `providerRuntimeKind.ts`, meaning it depends on the host platform hardware rather than an installable runtime

## Requirements

### Requirement 1: Unsigned macOS Release Disclaimer

**User Story:** As a macOS user downloading Olive Studio, I want clear instructions on how to open an unsigned application, so that I can launch the DMG without confusion on first run.

#### Acceptance Criteria

1. THE Release_Pipeline SHALL continue producing a universal macOS DMG artifact in the release workflow without code signing or notarization.
2. THE Studio SHALL include a disclaimer section in the project README that states the macOS DMG is unsigned and instructs the user to right-click the application and select "Open" on first launch to bypass Gatekeeper.
3. THE Studio SHALL include the same unsigned-app disclaimer in GitHub Release notes for any release containing a macOS DMG artifact.
4. THE Studio SHALL NOT include any automated `xattr -cr` commands or signing workarounds in scripts or documentation.

### Requirement 2: CoreML Runtime Detection

**User Story:** As a macOS Apple Silicon user, I want Olive Studio to report CoreML as locally available only when the active ONNX Runtime can execute it, while keeping CoreML selectable as a recipe target.

#### Acceptance Criteria

1. WHEN the default ORT runtime providers list includes `CoreMLExecutionProvider`, THE Detection_Service SHALL include it in the detected providers list.
2. WHEN the default ORT runtime providers list does not include `CoreMLExecutionProvider`, THE Detection_Service SHALL NOT include it based on Apple Silicon hardware alone.
3. THE Studio SHALL keep `CoreMLExecutionProvider` selectable as a platform-local recipe target even when it is not locally detected.
4. THE Execute Live path SHALL remain unavailable until the default ORT runtime reports `CoreMLExecutionProvider`.

### Requirement 3: CoreML Recommended Provider Priority

**User Story:** As a macOS Apple Silicon user with CoreML detected, I want CoreML to be recommended over CPU but below GPU-accelerated providers, so that the auto-selected provider matches my hardware capability.

#### Acceptance Criteria

1. WHEN CoreML_EP is in the detected providers list AND no NVIDIA/ROCm/DirectML GPU provider is detected, THE Recommendation_Service SHALL select `CoreMLExecutionProvider` over `CPUExecutionProvider`.
2. WHEN both CoreML_EP and a GPU-accelerated provider (CUDA, TensorRT, TensorRT-RTX, ROCm, DirectML) are detected, THE Recommendation_Service SHALL prefer the GPU-accelerated provider over CoreML_EP.
3. THE Recommendation_Service SHALL place CoreML_EP at a priority above `CPUExecutionProvider` and below `OpenVINOExecutionProvider` in the priority list.

### Requirement 4: CoreML Pipeline Validation — Blocked Quantization Methods

**User Story:** As a user building a recipe for CoreML, I want the pipeline to prevent incompatible GPU-only quantization methods, so that I do not produce invalid recipes.

#### Acceptance Criteria

1. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL block selection of AWQ quantization.
2. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL block selection of GPTQ quantization.
3. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL block selection of SpinQuant quantization.
4. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL block selection of QuaRot quantization.
5. WHEN a user attempts to select a blocked quantization method with CoreML_EP active, THE Validation_Engine SHALL auto-coerce the quantization method to a compatible default or display a validation error with severity "critical".

### Requirement 5: CoreML Pipeline Validation — Allowed Quantization Methods

**User Story:** As a user targeting CoreML, I want CPU-capable quantization methods to remain available, so that I can optimize my model for Apple hardware.

#### Acceptance Criteria

1. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL allow selection of PTQ quantization.
2. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL allow selection of RTN quantization.
3. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL allow selection of KQuant quantization.
4. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL allow selection of QAT quantization.
5. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL allow selection of HQQ quantization.
6. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL allow selection of LoRA fine-tuning.
7. WHILE `CoreMLExecutionProvider` is the selected provider, THE Validation_Engine SHALL reject QLoRA and coerce it to LoRA because CoreML is not a supported QLoRA training backend.

### Requirement 6: CoreML Venv Supplemental Dependency

**User Story:** As a user running an Olive optimization targeting CoreML, I want `coremltools` to be installed automatically in the default venv, so that the optimization can produce CoreML-compatible artifacts.

#### Acceptance Criteria

1. WHEN `CoreMLExecutionProvider` is the selected provider and an Olive job is initiated, THE Venv_Service SHALL install the `coremltools` Python package as a supplemental dependency in the default venv family.
2. THE Venv_Service SHALL NOT create a dedicated venv family for CoreML; it SHALL use the existing default family.
3. IF `coremltools` installation fails, THEN THE Venv_Service SHALL report the error to the user through the setup listener and return a failure result.
4. WHEN `coremltools` is already installed in the default venv, THE Venv_Service SHALL skip redundant installation.

### Requirement 7: MCP Knowledge Base — CoreML Hardware Profile

**User Story:** As an AI assistant user querying hardware profiles through MCP, I want CoreML to appear as a documented hardware profile, so that the assistant can recommend CoreML-compatible configurations.

#### Acceptance Criteria

1. THE MCP_Knowledge_Base SHALL contain a CoreML entry in `hardware_profiles.json` specifying the platform constraint (macOS, Apple Silicon), supported ORT execution provider name, and compatible pass types.
2. THE MCP_Knowledge_Base SHALL list CoreML-incompatible quantization methods (AWQ, GPTQ, SpinQuant, QuaRot) in the hardware profile's exclusion metadata.
3. THE MCP_Knowledge_Base SHALL list CoreML-compatible quantization methods (PTQ, RTN, KQuant, QAT, HQQ) and LoRA in the hardware profile's inclusion metadata, and SHALL list QLoRA as incompatible.

### Requirement 8: MCP Knowledge Base — Pass Compatibility

**User Story:** As an AI assistant user querying pass compatibility through MCP, I want passes.json to accurately reflect CoreML's quantization compatibility, so that the assistant provides correct recommendations.

#### Acceptance Criteria

1. WHEN a pass entry in `passes.json` lists compatible providers, THE MCP_Knowledge_Base SHALL include `CoreMLExecutionProvider` for passes compatible with CoreML (PTQ, RTN, KQuant, QAT, HQQ, LoRA, OnnxConversion).
2. WHEN a pass entry in `passes.json` lists compatible providers for GPU-only quantization or training (AWQ, GPTQ, SpinQuant, QuaRot, QLoRA), THE MCP_Knowledge_Base SHALL NOT include `CoreMLExecutionProvider`.

### Requirement 9: Provider Card — CoreML Hardware Context

**User Story:** As a user viewing the IHV Integration Panel with CoreML detected, I want to see Apple Neural Engine and Apple GPU context in the provider card, so that I understand what hardware CoreML leverages.

#### Acceptance Criteria

1. WHEN CoreML_EP is detected and displayed in the IHV panel, THE Provider_Card SHALL show "Apple Neural Engine / Apple GPU" as the hardware context description.
2. THE Provider_Card SHALL display the platform constraint ("macOS Apple Silicon") in the requirements tooltip.
3. THE Provider_Card SHALL display compatible quantization methods ("PTQ INT8, FP16") in the tooltip.
4. THE Provider_Card SHALL display a recommendation note indicating CoreML is suitable for Apple edge deployment and requires fixed input shapes for optimal performance.
