"""Preload ONNX Runtime CUDA/cuDNN DLLs, patch Olive EP registration, then run Olive CLI."""
from __future__ import annotations

import logging
import sys


def _patch_olive_ep_registration() -> None:
    """Olive 0.13+ auto-registers every built-in ORT EP on Windows (register_execution_provider_library).

    TensorRT's bundled DLL does not export CreateEpFactories, so registration aborts the run
    even for CUDA-only recipes. Force the classic InferenceSession(providers=...) path instead.
    """
    import olive.common.ort_inference as ort_inference

    def ort_supports_ep_devices_patched() -> bool:
        return False

    def maybe_register_ep_libraries_patched(ep_paths: dict[str, str]) -> None:
        del ep_paths
        logging.getLogger(__name__).debug(
            "Skipping Olive EP plugin registration (classic ORT provider path)."
        )

    ort_inference.ort_supports_ep_devices = ort_supports_ep_devices_patched
    ort_inference.maybe_register_ep_libraries = maybe_register_ep_libraries_patched


def main() -> None:
    try:
        import onnxruntime as ort

        ort.preload_dlls(cuda=True, cudnn=True, msvc=True)
    except Exception as exc:
        print(f"[olive-gpu] preload_dlls warning: {exc}", file=sys.stderr)

    _patch_olive_ep_registration()

    # Olive CLI expects argv like: olive run --config ...
    if len(sys.argv) > 1:
        sys.argv = ["olive", *sys.argv[1:]]

    from olive.cli.launcher import main as olive_main

    olive_main(called_as_console_script=False)


if __name__ == "__main__":
    main()
