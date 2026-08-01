from olive_mcp_server.mcp_server import call_tool, _TOOL_IMPORTS

def test_call_tool_dispatches_troubleshoot():
    result = call_tool("troubleshoot_olive_error", {"error_message": "unexpected keyword argument hf_config"})
    assert isinstance(result, dict)
    assert "title" in result
    assert "root_cause" in result
    assert "workaround" in result

def test_call_tool_unknown_returns_error():
    result = call_tool("not_a_real_tool", {})
    assert result.get("error")
    assert "Unknown tool" in result["error"]

def test_call_tool_names_match_registered_tools():
    assert "troubleshoot_olive_error" in _TOOL_IMPORTS
