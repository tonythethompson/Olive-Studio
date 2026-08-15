# Design Document — macOS Unsigned Release & CoreML Execution Provider

## Overview

This feature completes CoreML's integration path in Olive Studio, connecting the existing type/catalog stubs to live behavior across six layers: detection, recommendation, validation, venv capability, MCP knowledge base, and provider card UI. A secondary concern adds unsigned-DMG user guidance for macOS releases.

The design touches multiple independent subsystems but each change is small, additive, and follows established patterns already used by QNN, OpenVINO, and CUDA providers.

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  IHV Integration Panel (Provider Cards)                                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────────┐ ┌─────────────────┐ │
│  │ CUDA Card  │ │ QNN Card   │ │ CoreML Card    │ │ CPU Card        │ │
│  └────────────┘ └────────────┘ └────────────────┘ └─────────────────┘ │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│  hardwareProbe.ts                                                       │
│  ┌──────────────────────────┐  ┌─────────────────────────────┐         │
│  │ mergeDetectedProviders() │  │ pickRecommendedProvider()    │         │
│  │ + isMacAppleSilicon flag │  │ + CoreML in priority list    │         │
│  └──────────────────────────┘  └─────────────────────────────┘         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│  pipelineStateCommit.ts + pipelineValidation.ts                         │
│  ┌──────────────────────────┐  ┌─────────────────────────────┐         │
│  │ isQuantMethodAllowed()   │  │ getProviderConflicts()       │         │
│  │ CoreML ∉ GPU_PROVIDERS   │  │ AWQ/GPTQ/SpinQuant/QuaRot   │         │
│  │ CoreML = CPU-compat set  │  │ blocked with autofix → ptq  │         │
│  └──────────────────────────┘  └─────────────────────────────┘         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│  venv/capabilityEnsure.ts                                               │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │ installCapabilityPackages(CoreMLExecutionProvider)            │       │
│  │ → ensureCoremltools() → pip install coremltools (idempotent) │       │
│  └──────────────────────────────────────────────────────────────┘       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────────────┐
│  MCP Knowledge Base                                                     │
│  ┌─────────────────────────┐  ┌──────────────────────────┐             │
│  │ hardware_profiles.json  │  │ passes.json              │             │
│  │ + CoreML entry          │  │ + CoreML in compatible   │             │
│  └─────────────────────────┘  └──────────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Detection — `mergeDetectedProviders()` Enhancement

**File:** `src/lib/hardwareProbe.ts`

Add an `isMacAppleSilicon?: boolean` parameter to the input object. When `true`, add `CoreMLExecutionProvider` to the detected set (soft-detection). The ORT providers list path already handles CoreML via `mapOrtProvidersToIhv()` — no change needed there.

```typescript
export function mergeDetectedProviders(input: {
  // ... existing fields ...
  /** True when platform is darwin AND arch is arm64 (Apple Silicon). */
  isMacAppleSilicon?: boolean;
}): IHVProvider[] {
  const detected = new Set<IHVProvider>(["CPUExecutionProvider"]);
  // ... existing logic ...

  // CoreML soft-detection: Apple Silicon macOS
  if (input.isMacAppleSilicon) {
    detected.add("CoreMLExecutionProvider");
  }

  return Array.from(detected);
}
```

The server-side probe endpoint (`/api/system/hardware`) already reports `os` and `arch`; the caller computes `isMacAppleSilicon = os === 'darwin' && arch === 'arm64'` and passes it in.

### 2. Recommendation — `pickRecommendedProvider()` Priority

**File:** `src/lib/hardwareProbe.ts`

Insert `CoreMLExecutionProvider` in the priority array between `OpenVINOExecutionProvider` (or its loadable variant) and `WebGpuExecutionProvider`. This places CoreML above CPU but below all GPU-accelerated and OpenVINO providers.

```typescript
const priority: IHVProvider[] = [
  // ... TensorRT RTX (loadable), TensorRT (loadable), QNN (loadable) ...
  "CUDAExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "TensorrtExecutionProvider",
  "ROCMExecutionProvider",
  "DmlExecutionProvider",
  ...(opts?.openvinoLoadable ? (["OpenVINOExecutionProvider"] as const) : []),
  "CoreMLExecutionProvider",   // ← NEW: above CPU, below GPU/OpenVINO
  "WebGpuExecutionProvider",
  "CPUExecutionProvider",
];
```

### 3. Validation — Quantization Method Allow/Block

**File:** `src/lib/pipelineStateCommit.ts`

CoreML is NOT in `GPU_PROVIDERS`. The existing `isQuantMethodAllowed()` logic already blocks AWQ, GPTQ, SpinQuant, and QuaRot for non-GPU providers. However, CoreML must also be treated like `CPUExecutionProvider` for `hqq`, `rtn`, and `kquant` (which currently only allow CPU/CUDA). The fix:

```typescript
export function isQuantMethodAllowed(
  method: UIState["passes"]["quantMethod"],
  provider: IHVProvider,
): boolean {
  if (method === "awq") {
    return GPU_PROVIDERS.includes(provider);
  }
  if (method === "gptq") {
    return GPU_PROVIDERS.includes(provider);
  }
  if (method === "qat") {
    return provider !== "QNNExecutionProvider" && provider !== "QnnAbiExecutionProvider";
  }
  if (method === "hqq" || method === "rtn" || method === "kquant") {
    // CPU, CUDA, and CoreML (Apple CPU/ANE path) support these methods.
    return (
      provider === "CPUExecutionProvider" ||
      provider === "CUDAExecutionProvider" ||
      provider === "CoreMLExecutionProvider"
    );
  }
  if (method === "spinquant" || method === "quarot") {
    return GPU_PROVIDERS.includes(provider);
  }
  return true; // ptq is universally allowed
}
```

**File:** `src/lib/pipelineValidation.ts` — `getProviderConflicts()`

The existing conflict rules for AWQ/GPTQ/SpinQuant/QuaRot already use `!isQuantMethodAllowed(method, providerId)`. Since CoreML is not in `GPU_PROVIDERS`, these conflicts fire automatically. No new rule entries needed — the existing pattern handles CoreML.

**PEFT/LoRA:** CoreML is NOT in `PEFT_UNSUPPORTED_PROVIDERS`, so `isPeftAllowed()` returns `true`. For QLoRA: `isPeftMethodAllowed("qlora", provider)` checks `GPU_PROVIDERS` — CoreML is not there, so QLoRA would be blocked. Per requirement 5.7, QLoRA must be allowed for CoreML. Fix:

```typescript
export function isPeftMethodAllowed(
  method: UIState["passes"]["peftMethod"],
  provider: IHVProvider,
): boolean {
  if (method === "qlora") {
    return GPU_PROVIDERS.includes(provider) || provider === "CoreMLExecutionProvider";
  }
  return true;
}
```

### 4. Venv Capability — `coremltools` Supplemental Install

**File:** `src/server/services/venv/capabilityEnsure.ts`

Replace the no-op `CoreMLExecutionProvider` case in `installCapabilityPackages()` with a call to a new `ensureCoremltools()` helper:

```typescript
case "CoreMLExecutionProvider": {
  const result = await ensureCoremltools(onLine);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
```

**New file:** `src/server/services/olive/coreml.ts`

```typescript
import { getVenvPython } from "../venv/paths.ts";
import { runPythonModule } from "../venv/run.ts";

type SetupListener = (line: string) => void;

export async function ensureCoremltools(
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  const family = "default";
  const py = getVenvPython(family);
  if (!py) {
    return { ok: false, error: "No Python found in default venv for coremltools install" };
  }

  // Check if already installed (idempotent)
  try {
    await runPythonModule(py, ["-m", "pip", "show", "coremltools"], () => {}, {});
    onLine("[coreml] coremltools already installed — skipping");
    return { ok: true };
  } catch {
    // Not installed — proceed with install
  }

  onLine("[coreml] Installing coremltools...");
  try {
    await runPythonModule(
      py,
      ["-m", "pip", "install", "coremltools"],
      onLine,
      {},
    );
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `coremltools installation failed: ${msg}` };
  }
}
```

The `resolveVenvFamily("CoreMLExecutionProvider")` already returns `"default"` because `mandatoryFamilyForProvider` returns `null` for CoreML. No new venv family needed.

### 5. MCP Knowledge Base Updates

**File:** `olive-mcp-server/olive_mcp_server/knowledge_base/hardware_profiles.json`

Add a CoreML entry:

```json
{
  "id": "coreml",
  "name": "Apple CoreML (Neural Engine / Apple GPU)",
  "ort_provider": "CoreMLExecutionProvider",
  "platform": {
    "os": "macOS",
    "arch": "arm64",
    "description": "Apple Silicon (M1/M2/M3/M4 series)"
  },
  "compatible_passes": ["OnnxConversion", "OnnxStaticQuantization", "OnnxDynamicQuantization", "OnnxRtnQuantization", "OnnxKquantQuantization", "OnnxQatQuantization", "OnnxHqqQuantization", "LoRA", "QLoRA"],
  "incompatible_passes": ["OnnxAwqQuantization", "OnnxGptqQuantization", "OnnxSpinQuantQuantization", "OnnxQuaRotQuantization"],
  "notes": "CoreML targets the Apple Neural Engine and Apple GPU. Fixed input shapes recommended for optimal ANE scheduling. Requires coremltools for model conversion."
}
```

**File:** `olive-mcp-server/olive_mcp_server/knowledge_base/passes.json`

For each pass entry that lists `compatible_providers`:
- Add `"CoreMLExecutionProvider"` to: OnnxConversion, OnnxStaticQuantization (PTQ), OnnxDynamicQuantization, OnnxRtnQuantization, OnnxKquantQuantization, OnnxQatQuantization, OnnxHqqQuantization, LoRA, QLoRA
- Ensure `"CoreMLExecutionProvider"` is NOT in: OnnxAwqQuantization, OnnxGptqQuantization, OnnxSpinQuantQuantization, OnnxQuaRotQuantization

### 6. Provider Card — CoreML Context

**File:** `src/lib/providerCatalog.ts`

Update the existing `CoreMLExecutionProvider` catalog entry tooltip:

```typescript
{
  id: "CoreMLExecutionProvider",
  name: "Apple CoreML",
  shortName: "CoreML",
  desc: "Apple Neural Engine / Apple GPU via CoreML on macOS and iOS (platform-local when ORT lists it).",
  icon: CpuIcon,
  tooltip: {
    requirements: "macOS Apple Silicon (M1/M2/M3/M4). Prefer fixed input shapes for optimal ANE scheduling.",
    quantMethods: "PTQ INT8, FP16. KQuant, RTN, HQQ, QAT also supported.",
    recommendation:
      "Suitable for Apple edge deployment. Fixed input shapes enable optimal Neural Engine scheduling. Execute Live requires Darwin host with ORT CoreML EP.",
  },
},
```

The `IHVIntegrationPanel` → `ProviderCard` component already reads from `getProviderCatalogEntry()` and renders `tooltip.requirements`, `tooltip.quantMethods`, and `tooltip.recommendation` in the card UI. No component changes needed — only data updates.

### 7. Unsigned macOS Release Documentation

**Files:** `README.md`, `.github/RELEASE_TEMPLATE.md` or workflow release notes

Add a "macOS Installation" section:

```markdown
### macOS Installation (Unsigned DMG)

The macOS DMG is not code-signed or notarized. On first launch, macOS
Gatekeeper will block the app. To open it:

1. Right-click (or Control-click) the Olive Studio application
2. Select **Open** from the context menu
3. Click **Open** in the confirmation dialog

This is only required on first launch. Subsequent launches work normally.
```

No `xattr -cr` commands or signing workarounds are included.

## Data Models

### `mergeDetectedProviders` Input Extension

```typescript
interface MergeDetectedProvidersInput {
  // ... existing fields unchanged ...
  /** True when platform is darwin AND arch is arm64 (Apple Silicon). */
  isMacAppleSilicon?: boolean;
}
```

### CoreML Hardware Profile (MCP Knowledge Base)

```typescript
interface CoreMLHardwareProfile {
  id: "coreml";
  name: string;
  ort_provider: "CoreMLExecutionProvider";
  platform: {
    os: "macOS";
    arch: "arm64";
    description: string;
  };
  compatible_passes: string[];
  incompatible_passes: string[];
  notes: string;
}
```

## Error Handling

| Scenario | Handler | Behavior |
|----------|---------|----------|
| `coremltools` pip install fails | `ensureCoremltools()` | Returns `{ ok: false, error }`, propagated to job setup listener |
| CoreML + AWQ selected | `getProviderConflicts()` | Returns critical conflict; `applyProviderConflictAutofixes()` coerces to PTQ |
| CoreML + QLoRA on non-GPU host | Allowed per requirements | QLoRA is unblocked for CoreML (ANE can calibrate, train offloads to CPU/ANE) |
| `isMacAppleSilicon` not provided | `mergeDetectedProviders()` | Treated as `false` — CoreML not soft-detected (backward-compatible default) |
| CoreML detected but ORT doesn't list it | `capabilityEnsure` platformLocal path | Returns error: "not registered in default runtime ORT" |

## Interfaces

### Public API Changes

No HTTP endpoint changes. All changes are internal to detection/validation/venv logic.

### Module Exports Changed

| Module | Change |
|--------|--------|
| `src/lib/hardwareProbe.ts` | `mergeDetectedProviders` input type adds `isMacAppleSilicon` |
| `src/lib/pipelineStateCommit.ts` | `isQuantMethodAllowed` — CoreML added to HQQ/RTN/KQuant allowlist |
| `src/lib/pipelineStateCommit.ts` | `isPeftMethodAllowed` — CoreML added to QLoRA allowlist |
| `src/server/services/venv/capabilityEnsure.ts` | CoreML case calls `ensureCoremltools()` |
| `src/server/services/olive/coreml.ts` | New module — `ensureCoremltools()` |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: CoreML soft-detected on Apple Silicon

*For any* input to `mergeDetectedProviders` where `isMacAppleSilicon` is `true`, the returned provider list SHALL contain `CoreMLExecutionProvider`, regardless of other input flags.

**Validates: Requirements 2.1**

### Property 2: CoreML not soft-detected on non-Apple-Silicon

*For any* input to `mergeDetectedProviders` where `isMacAppleSilicon` is `false` (or undefined) AND `onnxRuntimeProviders` does NOT include `CoreMLExecutionProvider`, the returned provider list SHALL NOT contain `CoreMLExecutionProvider`.

**Validates: Requirements 2.2**

### Property 3: ORT-listed CoreML overrides platform check

*For any* input to `mergeDetectedProviders` where `onnxRuntimeProviders` includes `CoreMLExecutionProvider`, the returned provider list SHALL contain `CoreMLExecutionProvider`, regardless of `isMacAppleSilicon` value.

**Validates: Requirements 2.3**

### Property 4: CoreML recommended over CPU without GPU providers

*For any* detected provider list that contains both `CoreMLExecutionProvider` and `CPUExecutionProvider` but no provider from `{CUDAExecutionProvider, TensorrtExecutionProvider, NvTensorRTRTXExecutionProvider, ROCMExecutionProvider, DmlExecutionProvider}`, `pickRecommendedProvider` SHALL NOT return `CPUExecutionProvider`.

**Validates: Requirements 3.1**

### Property 5: GPU providers recommended over CoreML

*For any* detected provider list containing `CoreMLExecutionProvider` and at least one provider from `{CUDAExecutionProvider, TensorrtExecutionProvider, NvTensorRTRTXExecutionProvider, ROCMExecutionProvider, DmlExecutionProvider}`, `pickRecommendedProvider` SHALL NOT return `CoreMLExecutionProvider`.

**Validates: Requirements 3.2**

### Property 6: CoreML blocks GPU-only quantization methods

*For any* quantization method in `{awq, gptq, spinquant, quarot}`, `isQuantMethodAllowed(method, "CoreMLExecutionProvider")` SHALL return `false`.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 7: CoreML auto-coerces blocked quantization methods

*For any* pipeline state where `ihvProvider` is `CoreMLExecutionProvider`, `quantization` is `true`, and `quantMethod` is in `{awq, gptq, spinquant, quarot}`, `getProviderConflicts` SHALL return at least one conflict with `severity === "critical"` and an `autofix` function that produces `{ quantMethod: "ptq" }`.

**Validates: Requirements 4.5**

### Property 8: CoreML allows CPU-compatible quantization and fine-tuning methods

*For any* quantization method in `{ptq, rtn, kquant, qat, hqq}`, `isQuantMethodAllowed(method, "CoreMLExecutionProvider")` SHALL return `true`. Additionally, `isPeftAllowed("CoreMLExecutionProvider")` SHALL return `true`, and *for any* PEFT method in `{lora, qlora}`, `isPeftMethodAllowed(method, "CoreMLExecutionProvider")` SHALL return `true`.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**

### Property 9: MCP passes.json includes CoreML for compatible passes

*For any* pass name in the CoreML-compatible set `{OnnxConversion, OnnxStaticQuantization, OnnxDynamicQuantization, OnnxRtnQuantization, OnnxKquantQuantization, OnnxQatQuantization, OnnxHqqQuantization, LoRA, QLoRA}`, its entry in `passes.json` SHALL list `CoreMLExecutionProvider` in the `compatible_providers` array.

**Validates: Requirements 8.1**

### Property 10: MCP passes.json excludes CoreML for GPU-only passes

*For any* pass name in the GPU-only set `{OnnxAwqQuantization, OnnxGptqQuantization, OnnxSpinQuantQuantization, OnnxQuaRotQuantization}`, its entry in `passes.json` SHALL NOT list `CoreMLExecutionProvider` in the `compatible_providers` array.

**Validates: Requirements 8.2**
