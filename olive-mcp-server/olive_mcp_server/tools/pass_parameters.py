"""Tool: get_pass_parameters."""

from typing import Any

from . import load_passes


def get_pass_parameters(pass_name: str, parameter_name: str = "") -> dict[str, Any]:
    """
    Retrieve documentation for an Olive pass or one of its parameters.
    
    Parameters:
        pass_name (str): Name of the Olive pass to document.
        parameter_name (str): Optional name of a specific parameter to document.
    
    Returns:
        dict[str, Any]: Pass-level or parameter-level documentation, or an error
        with available pass or parameter names when the requested item is not found.
    """
    passes = {p["name"]: p for p in load_passes()}
    meta = passes.get(pass_name)
    if not meta:
        return {
            "error": f"Pass '{pass_name}' not found.",
            "available": sorted(passes.keys()),
        }

    params = meta.get("optional_params", {})
    if parameter_name:
        param = params.get(parameter_name)
        if not param:
            return {
                "error": f"Parameter '{parameter_name}' not found for pass '{pass_name}'.",
                "available_params": sorted(params.keys()),
            }
        return {
            "pass_name": pass_name,
            "parameter_name": parameter_name,
            "documentation": param,
            "required": parameter_name in meta.get("required_params", []),
        }

    return {
        "pass_name": pass_name,
        "description": meta.get("description"),
        "required_params": meta.get("required_params", []),
        "parameters": params,
        "gotchas": meta.get("gotchas", []),
    }
