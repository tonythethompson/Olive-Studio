"""Unit tests for plan_optimization tool (agent_planner.py).

All tests monkeypatch studio_request so no live Studio or network access is needed.
Requirements: 13.2, 13.6, 13.7
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from olive_mcp_server.tools.agent_planner import plan_optimization


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_studio_request_success(
    method: str, path: str, *, body: Any = None, timeout: float = 5.0
) -> dict[str, Any]:
    """Simulate a successful Studio bridge validation (returns empty dict = no error)."""
    return {}


def _mock_studio_request_unavailable(
    method: str, path: str, *, body: Any = None, timeout: float = 5.0
) -> dict[str, Any]:
    """Simulate Studio bridge unavailability."""
    return {"error": "studio_unavailable", "message": "Studio is unreachable"}


# ---------------------------------------------------------------------------
# Test: LLM intent parsing
# ---------------------------------------------------------------------------


class TestLLMIntentParsing:
    """Test that an LLM + NVIDIA + int4 intent produces the expected UIState patch."""

    def test_llm_nvidia_int4(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Intent with hardware (nvidia), model family (llama), and goal (int4).

        Validates: Requirements 13.2 — LLM intent parsing
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize llama model for nvidia gpu with int4"
        )

        # Must not be an error
        assert "error" not in result
        assert result["validated"] is True

        patch = result["ui_state_patch"]
        # Hardware provider detected
        assert "ihvProvider" in patch
        assert "CUDA" in patch["ihvProvider"] or "Tensorrt" in patch["ihvProvider"]

        # Quantization settings
        passes = patch.get("passes", {})
        assert passes.get("quantization") is True
        assert passes.get("quantPrecision") == "int4"

    def test_llm_nvidia_int4_json_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JSON serialization round-trip for LLM intent result.

        Validates: Requirements 13.7
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize llama model for nvidia gpu with int4"
        )
        assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# Test: CNN intent parsing
# ---------------------------------------------------------------------------


class TestCNNIntentParsing:
    """Test that a CNN + Intel/OpenVINO intent produces appropriate results."""

    def test_cnn_openvino(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Intent referencing ResNet + OpenVINO should infer CNN model type and Intel provider.

        Validates: Requirements 13.2 — CNN intent parsing
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="optimize resnet for intel openvino")

        assert "error" not in result
        patch = result["ui_state_patch"]

        # Intel / OpenVINO provider
        assert "ihvProvider" in patch
        assert "OpenVINO" in patch["ihvProvider"] or "intel" in patch["ihvProvider"].lower()

    def test_cnn_openvino_json_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JSON round-trip for CNN intent.

        Validates: Requirements 13.7
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="optimize resnet for intel openvino")
        assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# Test: Hardware probe override
# ---------------------------------------------------------------------------


class TestHardwareProbeOverride:
    """Test that hardware_probe overrides intent-inferred provider and CUDA version."""

    def test_probe_overrides_provider(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """hardware_probe.ihvProvider should override intent-inferred provider.

        Validates: Requirements 13.2
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize for gpu",
            hardware_probe={"ihvProvider": "amd", "cudaVersion": "12"},
        )

        assert "error" not in result
        patch = result["ui_state_patch"]

        # Probe should override to AMD/ROCm
        assert patch["ihvProvider"] == "ROCMExecutionProvider"
        # CUDA version from probe
        assert patch["cudaVersion"] == "12"

    def test_probe_override_json_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JSON round-trip for hardware probe override result.

        Validates: Requirements 13.7
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize for gpu",
            hardware_probe={"ihvProvider": "amd", "cudaVersion": "12"},
        )
        assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# Test: Studio-down degradation
# ---------------------------------------------------------------------------


class TestStudioDownDegradation:
    """Test that the tool degrades gracefully when Studio is unavailable."""

    def test_validated_false_when_studio_down(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When Studio returns studio_unavailable, validated should be False with a note.

        Validates: Requirements 13.2 — Studio-down degradation
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_unavailable,
        )

        result = plan_optimization(intent="optimize bert for cpu with int8")

        assert "error" not in result
        assert result["validated"] is False
        assert "validation_note" in result
        assert "unavailable" in result["validation_note"].lower()

        # Should still produce a valid patch
        patch = result["ui_state_patch"]
        assert isinstance(patch, dict)
        assert "passes" in patch

    def test_studio_down_json_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JSON round-trip for Studio-down result.

        Validates: Requirements 13.7
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_unavailable,
        )

        result = plan_optimization(intent="optimize bert for cpu with int8")
        assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# Test: Unparseable intent
# ---------------------------------------------------------------------------


class TestUnparseableIntent:
    """Test that intents with no recognizable elements return unparseable_intent error."""

    def test_gibberish_returns_unparseable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Random text with no hardware/model/goal → unparseable_intent error.

        Validates: Requirements 13.2
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="hello world how are you")

        assert result.get("error") == "unparseable_intent"
        assert "message" in result
        assert "ui_state_patch" not in result

    def test_unparseable_json_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JSON round-trip for unparseable intent error.

        Validates: Requirements 13.7
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="hello world how are you")
        assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# Test: model_id usage
# ---------------------------------------------------------------------------


class TestModelIdUsage:
    """Test that providing model_id populates hfModelId and modelSource."""

    def test_model_id_in_patch(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """model_id should appear as hfModelId in the patch with modelSource=huggingface.

        Validates: Requirements 13.2
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize for nvidia",
            model_id="meta-llama/Llama-2-7b",
        )

        assert "error" not in result
        patch = result["ui_state_patch"]
        assert patch.get("hfModelId") == "meta-llama/Llama-2-7b"
        assert patch.get("modelSource") == "huggingface"

    def test_model_id_json_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JSON round-trip for model_id result.

        Validates: Requirements 13.7
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize for nvidia",
            model_id="meta-llama/Llama-2-7b",
        )
        assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# Test: Alternatives generation
# ---------------------------------------------------------------------------


class TestAlternativesGeneration:
    """Verify alternatives field structure and constraints (0-3 items)."""

    def test_alternatives_structure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Alternatives should be a list of 0-3 dicts, each with description + ui_state_patch.

        Validates: Requirements 13.2, 13.6
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize llama model for nvidia gpu with int4"
        )

        assert "error" not in result
        alternatives = result["alternatives"]
        assert isinstance(alternatives, list)
        assert len(alternatives) <= 3

        for alt in alternatives:
            assert isinstance(alt, dict)
            assert "description" in alt
            assert isinstance(alt["description"], str)
            assert len(alt["description"]) > 0
            assert "ui_state_patch" in alt
            assert isinstance(alt["ui_state_patch"], dict)

    def test_alternatives_json_roundtrip(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """JSON round-trip for alternatives.

        Validates: Requirements 13.7
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize llama model for nvidia gpu with int4"
        )
        assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# Test: Response structure completeness
# ---------------------------------------------------------------------------


class TestResponseStructure:
    """Verify all required fields are present in successful responses."""

    def test_success_contains_all_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Successful plan results must have ui_state_patch, reasoning, alternatives, validated.

        Validates: Requirements 13.2, 13.6
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="quantize llama for nvidia with int4")

        assert "ui_state_patch" in result
        assert isinstance(result["ui_state_patch"], dict)
        assert "reasoning" in result
        assert isinstance(result["reasoning"], str)
        assert len(result["reasoning"]) > 0
        assert "alternatives" in result
        assert isinstance(result["alternatives"], list)
        assert "validated" in result
        assert isinstance(result["validated"], bool)
        assert "side_effect" in result
        assert result["side_effect"] is False

    def test_error_response_structure(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Error responses must have error (snake_case) and message (non-empty).

        Validates: Requirements 13.6
        """
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="hello world how are you")

        assert "error" in result
        assert isinstance(result["error"], str)
        assert len(result["error"]) > 0
        # snake_case validation
        import re
        assert re.match(r"^[a-z][a-z0-9_]*$", result["error"])
        assert "message" in result
        assert isinstance(result["message"], str)
        assert len(result["message"]) > 0


# ---------------------------------------------------------------------------
# Test: Input validation edge cases
# ---------------------------------------------------------------------------


class TestInputValidation:
    """Edge cases for input validation."""

    def test_empty_intent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Empty intent returns invalid_input error."""
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="")
        assert result.get("error") == "invalid_input"

    def test_intent_too_long(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Intent > 2000 chars returns invalid_input error."""
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(intent="a" * 2001)
        assert result.get("error") == "invalid_input"

    def test_model_id_too_long(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """model_id > 200 chars returns invalid_input error."""
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_planner.studio_request",
            _mock_studio_request_success,
        )

        result = plan_optimization(
            intent="quantize for nvidia", model_id="x" * 201
        )
        assert result.get("error") == "invalid_input"
