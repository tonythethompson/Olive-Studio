"""Unit tests for agent_diagnosis.diagnose_and_fix tool.

Requirements: 13.3, 13.6, 13.7
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from olive_mcp_server.tools.agent_diagnosis import diagnose_and_fix


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_troubleshoot(monkeypatch: pytest.MonkeyPatch):
    """Return a setter that configures the troubleshoot_olive_error mock."""

    def _set(return_value: dict[str, Any]):
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_diagnosis.troubleshoot_olive_error",
            lambda **kwargs: return_value,
        )

    return _set


@pytest.fixture()
def mock_studio_request(monkeypatch: pytest.MonkeyPatch):
    """Return a setter that configures the studio_request mock."""

    def _set(return_value: dict[str, Any]):
        monkeypatch.setattr(
            "olive_mcp_server.tools.agent_diagnosis.studio_request",
            lambda *args, **kwargs: return_value,
        )

    return _set


def _assert_json_roundtrip(result: dict[str, Any]) -> None:
    """Assert that the result survives JSON serialization."""
    assert json.loads(json.dumps(result)) == result


# ---------------------------------------------------------------------------
# 1. KB match with updated_config (patched recipe, fix_confidence: high)
# ---------------------------------------------------------------------------


def test_kb_match_with_updated_config(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """KB entry matched with updated_config + applyable=True -> fixed recipe + high confidence."""
    # Arrange
    kb_result = {
        "matched_entry": "oom-quantization",
        "applyable": True,
        "updated_config": {"passes": {"quantPrecision": "int8"}},
        "root_cause": "OOM during AWQ",
        "workaround": "Use int8",
    }
    mock_troubleshoot(kb_result)
    mock_studio_request({"valid": True})

    recipe = {"passes": {"quantPrecision": "int4", "quantMethod": "awq"}}

    # Act
    result = diagnose_and_fix(
        error_message="OutOfMemoryError during AWQ quantization",
        recipe=recipe,
    )

    # Assert
    assert "error" not in result
    assert result["fix_confidence"] == "high"
    assert result["fixed_recipe"] is not None
    assert result["fixed_recipe"]["passes"]["quantPrecision"] == "int8"
    # Original quantMethod preserved
    assert result["fixed_recipe"]["passes"]["quantMethod"] == "awq"
    assert len(result["changes_made"]) > 0
    assert result["recipe_validated"] is True
    assert result["side_effect"] is False
    _assert_json_roundtrip(result)


# ---------------------------------------------------------------------------
# 2. KB match without updated_config (fixed_recipe: None, medium confidence)
# ---------------------------------------------------------------------------


def test_kb_match_without_updated_config(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """KB entry matched but no updated_config -> no fix, medium confidence."""
    # Arrange
    kb_result = {
        "matched_entry": "ep-fallback-cpu",
        "applyable": False,
        "updated_config": {},
        "root_cause": "EP fallback",
        "workaround": "Check provider",
    }
    mock_troubleshoot(kb_result)
    mock_studio_request({})

    recipe = {"passes": {"quantPrecision": "int4"}}

    # Act
    result = diagnose_and_fix(
        error_message="ExecutionProvider fallback to CPU",
        recipe=recipe,
    )

    # Assert
    assert "error" not in result
    assert result["fixed_recipe"] is None
    assert result["changes_made"] == []
    assert result["fix_confidence"] == "medium"
    assert result["side_effect"] is False
    _assert_json_roundtrip(result)


# ---------------------------------------------------------------------------
# 3. No KB match (fix_confidence: none)
# ---------------------------------------------------------------------------


def test_no_kb_match(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """No KB entry matched -> no fix, none confidence."""
    # Arrange
    kb_result = {
        "matched_entry": None,
        "applyable": False,
        "updated_config": {},
        "root_cause": "",
        "workaround": "",
    }
    mock_troubleshoot(kb_result)
    mock_studio_request({})

    recipe = {"passes": {"quantPrecision": "int4"}}

    # Act
    result = diagnose_and_fix(
        error_message="Some completely unknown error occurred",
        recipe=recipe,
    )

    # Assert
    assert "error" not in result
    assert result["fixed_recipe"] is None
    assert result["fix_confidence"] == "none"
    assert result["side_effect"] is False
    _assert_json_roundtrip(result)


# ---------------------------------------------------------------------------
# 4. Bridge validation unavailable (recipe_validated: False)
# ---------------------------------------------------------------------------


def test_bridge_validation_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """Studio returns error during validation -> fixed recipe present but recipe_validated=False."""
    # Arrange
    kb_result = {
        "matched_entry": "oom-quantization",
        "applyable": True,
        "updated_config": {"passes": {"quantPrecision": "int8"}},
        "root_cause": "OOM during AWQ",
        "workaround": "Use int8",
    }
    mock_troubleshoot(kb_result)
    mock_studio_request({"error": "studio_unavailable", "message": "not reachable"})

    recipe = {"passes": {"quantPrecision": "int4", "quantMethod": "awq"}}

    # Act
    result = diagnose_and_fix(
        error_message="OutOfMemoryError during AWQ quantization",
        recipe=recipe,
    )

    # Assert
    assert "error" not in result
    assert result["fixed_recipe"] is not None
    assert result["fixed_recipe"]["passes"]["quantPrecision"] == "int8"
    assert result["recipe_validated"] is False
    assert result["fix_confidence"] == "high"
    assert result["side_effect"] is False
    _assert_json_roundtrip(result)


# ---------------------------------------------------------------------------
# 5. Invalid input length - empty and too long
# ---------------------------------------------------------------------------


def test_invalid_input_empty_error_message(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """Empty error_message -> invalid_input error."""
    # Arrange
    mock_troubleshoot({})  # should not be reached
    mock_studio_request({})

    recipe = {"passes": {}}

    # Act
    result = diagnose_and_fix(error_message="", recipe=recipe)

    # Assert
    assert result["error"] == "invalid_input"
    assert "1" in result["message"] and "4000" in result["message"]
    _assert_json_roundtrip(result)


def test_invalid_input_too_long_error_message(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """error_message > 4000 chars -> invalid_input error."""
    # Arrange
    mock_troubleshoot({})
    mock_studio_request({})

    recipe = {"passes": {}}
    long_msg = "x" * 4001

    # Act
    result = diagnose_and_fix(error_message=long_msg, recipe=recipe)

    # Assert
    assert result["error"] == "invalid_input"
    _assert_json_roundtrip(result)


# ---------------------------------------------------------------------------
# 6. Recipe not a dict -> invalid_input
# ---------------------------------------------------------------------------


def test_recipe_not_a_dict(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """recipe passed as a string -> invalid_input error."""
    # Arrange
    mock_troubleshoot({})
    mock_studio_request({})

    # Act
    result = diagnose_and_fix(
        error_message="some error",
        recipe="not a dict",  # type: ignore[arg-type]
    )

    # Assert
    assert result["error"] == "invalid_input"
    assert "object" in result["message"].lower() or "dict" in result["message"].lower()
    _assert_json_roundtrip(result)


# ---------------------------------------------------------------------------
# 7. Merge patch removes null keys
# ---------------------------------------------------------------------------


def test_merge_patch_removes_null_keys(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """updated_config with null value removes the key from recipe (RFC 7386)."""
    # Arrange
    kb_result = {
        "matched_entry": "remove-bad-key",
        "applyable": True,
        "updated_config": {"passes": {"badKey": None}},
        "root_cause": "Bad key present",
        "workaround": "Remove badKey",
    }
    mock_troubleshoot(kb_result)
    mock_studio_request({})  # validation success

    recipe = {"passes": {"badKey": "old", "goodKey": "keep"}}

    # Act
    result = diagnose_and_fix(
        error_message="Configuration error with badKey",
        recipe=recipe,
    )

    # Assert
    assert "error" not in result
    assert result["fixed_recipe"] is not None
    assert "badKey" not in result["fixed_recipe"]["passes"]
    assert result["fixed_recipe"]["passes"]["goodKey"] == "keep"
    assert result["fix_confidence"] == "high"
    assert result["side_effect"] is False
    _assert_json_roundtrip(result)


# ---------------------------------------------------------------------------
# 8. JSON round-trip (covered inline in each test above via _assert_json_roundtrip)
#    This test verifies it explicitly on a complex result structure.
# ---------------------------------------------------------------------------


def test_json_roundtrip_complex_result(
    monkeypatch: pytest.MonkeyPatch,
    mock_troubleshoot,
    mock_studio_request,
):
    """All success results survive JSON serialization round-trip."""
    # Arrange
    kb_result = {
        "matched_entry": "oom-quantization",
        "applyable": True,
        "updated_config": {"passes": {"quantPrecision": "int8"}, "newField": 42},
        "root_cause": "OOM during AWQ",
        "workaround": "Use int8 or reduce batch size",
    }
    mock_troubleshoot(kb_result)
    mock_studio_request({})

    recipe = {
        "passes": {"quantPrecision": "int4", "quantMethod": "awq"},
        "input_model": {"type": "ONNXModel", "config": {"model_path": "/model.onnx"}},
    }

    # Act
    result = diagnose_and_fix(
        error_message="OutOfMemoryError: CUDA out of memory",
        recipe=recipe,
    )

    # Assert - the full result round-trips through JSON
    assert "error" not in result
    serialized = json.dumps(result)
    deserialized = json.loads(serialized)
    assert deserialized == result
    # Sanity check the fixed recipe reflects the patch
    assert deserialized["fixed_recipe"]["passes"]["quantPrecision"] == "int8"
    assert deserialized["fixed_recipe"]["newField"] == 42
    assert deserialized["fixed_recipe"]["input_model"] == recipe["input_model"]
