# Qualcomm QNN execution provider (plugin 2.x)

Olive Studio isolates QNN in `.venvs/qnn` with:

- `onnxruntime==1.26.0` (standard wheel, not DirectML/GPU/OpenVINO)
- `onnxruntime-qnn==2.4.0` (plugin beside ORT)
- Tested NumPy pins per CPython minor (3.11–3.13)

`onnxruntime-qnn` is **not** an `OrtDistributionName`. It must not be treated as a conflicting ORT flavor.

## Host modes (Windows-first)

| Host | Mode |
|------|------|
| Windows ARM64 Snapdragon | Local QNN NPU **inference** (after NPU EpDevice + release gate) |
| Windows x64 | Plugin **preparation / AOT** only (not local HTP inference) |
| Other | Out of Windows-first release scope |

## Capabilities

- **Preparation:** plugin registered and any `QNNExecutionProvider` EpDevice appears
- **Inference:** Windows ARM64 + `OrtHardwareDeviceType.NPU` (CPU/emulator devices do not count)
- **Verified “QNN NPU ready”:** Snapdragon release gate + cached fail-closed HTP diagnostic

Until the Snapdragon release gate passes, the UI says **QNN runtime installed** (plus accurate prep/device wording), never **QNN NPU ready**.

## Olive session path

Production registration uses Olive’s native EP library path (`maybe_register_ep_libraries` / plugin import). Studio does **not** ship `sitecustomize` or `InferenceSession` monkeypatches.

## Fail-closed execution

QNN failures do not auto-fallback to DirectML or CPU. Use explicit **Retry with DirectML** or **Retry with CPU**.

## SDK-backed Olive passes

Plugin install alone does **not** enable every Olive QNN pass. Passes that still need `QNN_SDK_ROOT` / QAIRT (for example `QNNConversion`, model libgen, SDK context binaries) stay separately gated. Advanced QAIRT docs:

https://docs.qualcomm.com/bundle/publicresource/topics/80-63442-10/introduction.html

## Install

Hardware panel → QNN → **Install QNN runtime** (`POST /api/env/install-qnn`).

Optional ARM64 diagnostic: **Test QNN NPU** (`POST /api/env/test-qnn-npu`). Cached under `.olive-studio/qnn-htp-diagnostic.json`; never run on every status refresh.
