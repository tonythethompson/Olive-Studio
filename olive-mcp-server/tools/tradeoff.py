"""Tool: evaluate_optimization_tradeoff."""

from typing import Any

from . import load_passes


def evaluate_optimization_tradeoff(
    passes: list[str],
    model: str = "",
    evaluation_metrics: list[str] | None = None,
) -> dict[str, Any]:
    """Analyze quality vs. performance tradeoff for a pass sequence.

    Args:
        passes: Ordered list of pass names.
        model: Optional model name for context.
        evaluation_metrics: Metrics to predict, e.g. ["accuracy", "latency", "size"].

    Returns:
        Predicted outcomes for each metric, risk factors, and Pareto recommendations.
    """
    metrics = evaluation_metrics or ["accuracy", "latency", "size"]
    catalog = {p["name"]: p for p in load_passes()}

    accuracy = 100.0
    latency = 1.0
    size = 100.0
    risks = []
    unknown_passes = []

    for name in passes:
        meta = catalog.get(name)
        if not meta:
            unknown_passes.append(name)
            continue

        ptype = meta.get("type")
        if ptype == "quantization":
            size *= 0.25
            latency *= 0.35
            accuracy -= 1.5
            risks.append(f"{name}: quantization can drop accuracy if calibration data is poor.")
        elif ptype == "graph_optimization":
            latency *= 0.85
            size *= 0.95
            risks.append(f"{name}: graph optimization is usually safe but can change numerics.")
        elif ptype == "conversion":
            latency *= 1.05
            size *= 1.0
        elif ptype == "pruning":
            size *= (1 - 0.3)
            latency *= 0.8
            accuracy -= 2.0
            risks.append(f"{name}: pruning accuracy loss often requires fine-tuning to recover.")
        elif ptype == "finetuning":
            size *= 1.05
            latency *= 1.05
            accuracy += 1.0
        elif ptype == "distillation":
            size *= 0.9
            latency *= 0.9
            accuracy += 0.5
            risks.append(f"{name}: distillation is slow and depends on teacher-student compatibility.")

    predicted = {
        "accuracy": round(max(0.0, accuracy), 2),
        "latency": round(latency, 2),
        "size": round(max(0.0, size), 2),
    }

    requested = {m: predicted.get(m, 0.0) for m in metrics}

    recommendation = "This sequence is reasonable."
    if "accuracy" in metrics and predicted["accuracy"] < 95:
        recommendation = "Consider reducing quantization/pruning aggressiveness to recover accuracy."
    if "latency" in metrics and predicted["latency"] > 0.5:
        recommendation = "Latency improvement is modest; check pass ordering and EP selection."

    return {
        "passes": passes,
        "model": model,
        "evaluation_metrics": metrics,
        "predicted_outcomes": requested,
        "relative_to_baseline": {
            "accuracy_drop_percent": round(100 - predicted["accuracy"], 2),
            "latency_speedup": round(1 / predicted["latency"], 2) if predicted["latency"] > 0 else 0,
            "size_reduction_percent": round(100 - predicted["size"], 2),
        },
        "risk_factors": risks,
        "unknown_passes": unknown_passes,
        "pareto_recommendation": recommendation,
    }
