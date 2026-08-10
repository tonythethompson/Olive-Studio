# Feature: v0.3-agent-mcp-tools, Property 3: Unparseable Intent Rejection
"""Property-based tests for plan_optimization.

Property 3: For any random string that contains NONE of the recognized
hardware keywords, model reference patterns, or optimization keywords,
plan_optimization SHALL return an error with code "unparseable_intent".

Validates: Requirements 3.5
"""

from __future__ import annotations

import re
from unittest.mock import patch

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from olive_mcp_server.tools.agent_planner import plan_optimization

# ---------------------------------------------------------------------------
# Keyword / pattern sets (mirrors agent_planner.py triggers)
# ---------------------------------------------------------------------------

# Hardware keywords that trigger recognition (lowercased for matching)
_HARDWARE_TRIGGERS = [
    "nvidia", "rtx", "cuda", "tensorrt", "openvino", "intel",
    "qualcomm", "qnn", "snapdragon", "apple", "coreml", "directml",
    "rocm", "webgpu", "cpu", "npu",
]

# Model family names that trigger recognition
_MODEL_FAMILY_TRIGGERS = [
    "llama", "phi", "mistral", "qwen", "falcon", "gpt", "bert",
    "resnet", "mobilenet", "whisper", "vit", "yolo",
    "stable diffusion", "stablediffusion", "stable-diffusion",
    "deepseek", "mixtral", "efficientnet", "t5", "codellama",
]

# Optimization keywords that trigger recognition
_OPTIMIZATION_TRIGGERS = [
    "quantize", "quantization", "compress", "optimize", "optimise",
    "speed", "latency", "smaller", "int4", "int8", "awq", "gptq",
    "hqq", "prune", "pruning", "lora", "qlora", "fp16", "float16",
    "convert", "onnx", "reduce", "shrink", "accelerate", "faster",
]

# Combine all trigger words for filtering
_ALL_TRIGGERS = _HARDWARE_TRIGGERS + _MODEL_FAMILY_TRIGGERS + _OPTIMIZATION_TRIGGERS

# The HF model reference pattern: org/model (e.g. "meta-llama/Llama-2-7b")
# We also need to exclude strings containing a "/" surrounded by alphanum chars
# since that matches the org/model regex in agent_planner.
_HF_MODEL_PATTERN = re.compile(r"\b[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+\b")

# RTX pattern (rtx followed by digits)
_RTX_PATTERN = re.compile(r"rtx\s*\d{4}", re.IGNORECASE)

# MI pattern (mi followed by 3 digits) — matches AMD MI300X etc.
_MI_PATTERN = re.compile(r"mi\d{3}", re.IGNORECASE)


def _contains_any_trigger(text: str) -> bool:
    """Check if the text contains any keyword/pattern that would be parsed."""
    lower = text.lower()

    # Check word-boundary hardware triggers
    for kw in _HARDWARE_TRIGGERS:
        if re.search(rf"\b{re.escape(kw)}\b", lower):
            return True

    # Check RTX with digits pattern
    if _RTX_PATTERN.search(text):
        return True

    # Check MI with digits pattern (AMD)
    if _MI_PATTERN.search(text):
        return True

    # Check model family triggers (word boundary)
    for kw in _MODEL_FAMILY_TRIGGERS:
        if re.search(rf"\b{re.escape(kw)}\b", lower):
            return True

    # Check HF model reference pattern (org/model)
    if _HF_MODEL_PATTERN.search(text):
        return True

    # Check optimization triggers (word boundary)
    for kw in _OPTIMIZATION_TRIGGERS:
        if re.search(rf"\b{re.escape(kw)}\b", lower):
            return True

    return False


# ---------------------------------------------------------------------------
# Strategy: generate safe text that avoids all triggers
# ---------------------------------------------------------------------------

# Use a character set that's unlikely to form trigger words:
# Letters, digits, space, and basic punctuation — then filter out any
# accidental trigger matches.
_safe_text = st.text(
    alphabet=st.characters(
        whitelist_categories=("Lu", "Ll", "Nd"),
        whitelist_characters=".,!? ",
    ),
    min_size=1,
    max_size=100,
).filter(lambda s: not _contains_any_trigger(s))


# ---------------------------------------------------------------------------
# Property 3: Unparseable Intent Rejection
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(intent=_safe_text)
@patch("olive_mcp_server.tools.agent_planner.studio_request")
def test_unparseable_intent_returns_error(mock_studio, intent: str):
    """Property 3: Random strings with no hardware/model/optimization keywords
    SHALL produce an 'unparseable_intent' error.

    Validates: Requirements 3.5
    """
    result = plan_optimization(intent)

    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert "error" in result, (
        f"Expected 'error' key in result for intent={intent!r}, got {result}"
    )
    assert result["error"] == "unparseable_intent", (
        f"Expected error code 'unparseable_intent', got {result['error']!r} "
        f"for intent={intent!r}"
    )
    assert "message" in result, "Error response must include 'message' field"
    assert isinstance(result["message"], str) and len(result["message"]) > 0, (
        "Error 'message' must be a non-empty string"
    )
    # Should NOT have side_effect key on error path
    assert "side_effect" not in result, (
        "Error response should not contain 'side_effect' field"
    )
    # studio_request should never be called for unparseable intents
    mock_studio.assert_not_called()
