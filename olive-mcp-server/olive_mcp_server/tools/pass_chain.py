"""Tool: get_pass_chain."""

from typing import Any

from . import load_passes
from .normalization import normalize_framework


# Canonical ordering constraints: each pass type should appear after its
# dependencies in this list.
_TYPE_ORDER = [
    "finetuning",
    "conversion",
    "graph_optimization",
    "quantization",
    "performance_tuning",
    "distillation",
    "pruning",
]


def _type_index(pass_type: str) -> int:
    try:
        return _TYPE_ORDER.index(pass_type)
    except ValueError:
        return len(_TYPE_ORDER)


def get_pass_chain(pass_names: list[str], source_format: str = "") -> dict[str, Any]:
    """Validate and explain an ordered pass chain.

    Args:
        pass_names: List of pass names in intended execution order.
        source_format: Optional source model format ("onnx", "torch", "hf", etc.).
                      If not specified, infers from chain or emits warnings.

    Returns:
        Validation result, explanation, and reordering suggestions.
    """
    passes = {p["name"]: p for p in load_passes()}
    errors = []
    warnings = []
    resolved = []
    seen_pass_names: list[str] = []
    seen_types: list[str] = []

    for name in pass_names:
        meta = passes.get(name)
        if not meta:
            errors.append(f"Unknown pass '{name}'.")
            resolved.append({"name": name, "known": False})
            seen_pass_names.append(name)
            continue

        ptype = meta.get("type", "unknown")
        resolved.append({
            "name": name,
            "type": ptype,
            "input_formats": meta.get("input_formats", []),
            "output_formats": meta.get("output_formats", []),
            "known": True,
        })

        # Quantization passes that need ONNX must follow OnnxConversion (unless source is already ONNX).
        if ptype == "quantization" and "onnx" in meta.get("input_formats", []):
            if "OnnxConversion" not in seen_pass_names:
                # Check if source is already ONNX
                normalized_source = normalize_framework(source_format).lower()
                if normalized_source == "onnx":
                    # Source is already ONNX, no conversion needed
                    pass
                elif normalized_source in ("torch", "pytorch", "tf", "tensorflow"):
                    # Explicitly non-ONNX source, require conversion
                    errors.append(
                        f"Pass '{name}' requires an ONNX input but no OnnxConversion precedes it in the chain."
                    )
                else:
                    # Unknown/unspecified source format, emit warning instead of error
                    warnings.append(
                        f"Pass '{name}' requires an ONNX input but no OnnxConversion precedes it. "
                        f"If your source model is already ONNX, this is fine; otherwise add OnnxConversion."
                    )

        # Graph optimizations are more effective before quantization.
        if ptype == "graph_optimization" and "quantization" in seen_types:
            warnings.append(
                f"Pass '{name}' is a graph optimization placed after quantization. "
                "Consider moving graph optimizations earlier for a cleaner quantized graph."
            )

        # FP16 should generally be last; optimizing after FP16 can revert precision.
        if ptype == "graph_optimization" and "OnnxFloatToFloat16" in seen_pass_names:
            warnings.append(
                f"Pass '{name}' runs after OnnxFloatToFloat16; FP16 precision may be reverted by optimization."
            )

        seen_pass_names.append(name)
        seen_types.append(ptype)

    # Type ordering check.
    known_indices = []
    for n in pass_names:
        if n in passes:
            known_indices.append(_type_index(passes[n]["type"]))
        else:
            known_indices.append(-1)

    for i in range(len(known_indices) - 1):
        if known_indices[i] > known_indices[i + 1] and known_indices[i + 1] != -1:
            warnings.append(
                f"Pass '{pass_names[i]}' (type {passes[pass_names[i]]['type']}) "
                f"comes before '{pass_names[i + 1]}' (type {passes[pass_names[i + 1]]['type']}); "
                "consider reordering for the canonical pipeline."
            )

    valid = len(errors) == 0

    return {
        "valid": valid,
        "errors": errors,
        "warnings": warnings,
        "chain": resolved,
        "canonical_order": _TYPE_ORDER,
    }
