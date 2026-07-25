"""Tool: get_pass_config_template."""

from typing import Any

from . import load_passes


_TARGET_DEFAULTS = {
    "quality": {
        "calibration_sampling_size": 300,
        "per_channel": True,
        "reduce_range": False,
    },
    "latency": {
        "calibration_sampling_size": 100,
        "per_channel": False,
        "reduce_range": False,
    },
    "balanced": {
        "calibration_sampling_size": 128,
        "per_channel": False,
        "reduce_range": False,
    },
}


def _apply_target_defaults(pass_name: str, params: dict[str, Any], target: str) -> dict[str, Any]:
    """
    Merge optimization-target defaults with the provided pass parameters.
    
    Parameters:
        params (dict[str, Any]): Parameter values that override the target defaults.
        target (str): Optimization target used to select defaults. Unknown targets use the balanced defaults.
    
    Returns:
        dict[str, Any]: A merged parameter dictionary.
    """
    defaults = _TARGET_DEFAULTS.get(target, _TARGET_DEFAULTS["balanced"]).copy()
    merged = defaults.copy()
    merged.update(params)
    return merged


def get_pass_config_template(
    pass_name: str,
    framework: str = "onnx",
    optimization_target: str = "balanced",
) -> dict[str, Any]:
    """
    Generate an Olive workflow configuration scaffold for a single pass.
    
    Parameters:
        pass_name (str): Name of the Olive pass.
        framework (str): Source framework used to select the input model type.
        optimization_target (str): Optimization target: ``"quality"``, ``"latency"``, or ``"balanced"``.
    
    Returns:
        dict[str, Any]: A JSON-ready configuration scaffold with pass metadata, parameters, and engine settings. Returns an error dictionary if the pass or optimization target is invalid.
    """
    passes = {p["name"]: p for p in load_passes()}
    meta = passes.get(pass_name)
    if not meta:
        return {
            "error": f"Pass '{pass_name}' not found in catalog.",
            "available": sorted(passes.keys()),
        }

    target = optimization_target.lower()
    if target not in _TARGET_DEFAULTS:
        return {
            "error": f"Unknown optimization_target '{optimization_target}'. "
            "Choose: quality, latency, balanced.",
        }

    # Start with the pass default values.
    defaults = {
        k: v.get("default")
        for k, v in meta.get("optional_params", {}).items()
    }
    # Keep only non-null defaults.
    defaults = {k: v for k, v in defaults.items() if v is not None}
    params = _apply_target_defaults(pass_name, defaults, target)

    # Framework-specific input model type.
    framework_map = {
        "torch": "PyTorchModel",
        "pytorch": "PyTorchModel",
        "hf": "HfModel",
        "huggingface": "HfModel",
        "onnx": "ONNXModel",
        "tf": "TensorFlowModel",
        "tensorflow": "TensorFlowModel",
    }
    input_model_type = framework_map.get(framework.lower(), "PyTorchModel")

    # Canonical engine setup.
    config = {
        "input_model": {
            "type": input_model_type,
            "config": {
                "model_path": "<path/to/model>",
                "task": "text-generation",
            },
        },
        "systems": {
            "local_system": {
                "type": "LocalSystem",
                "config": {"accelerators": [{"device": "cpu", "execution_providers": ["CPUExecutionProvider"]}]},
            }
        },
        "passes": {
            pass_name: {
                "type": meta["class"],
                "params": params,
            }
        },
        "engine": {
            "search_strategy": False,
            "host": "local_system",
            "target": "local_system",
            "cache_dir": "~/.cache/olive",
            "output_dir": "./models/optimized",
        },
    }

    # Adjust required_params.
    for req in meta.get("required_params", []):
        if req not in params:
            params[req] = f"<REQUIRED: set {req}>"

    return {
        "pass_name": pass_name,
        "framework": framework,
        "optimization_target": target,
        "description": meta.get("description"),
        "required_params": meta.get("required_params", []),
        "gotchas": meta.get("gotchas", []),
        "config": config,
    }
