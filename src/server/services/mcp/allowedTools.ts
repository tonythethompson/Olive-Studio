/** Pinned MCP tool names exposed by olive-mcp-server (see olive_mcp_server/mcp_server.py). */
export const ALLOWED_MCP_TOOL_NAMES = new Set([
  "get_olive_passes",
  "get_pass_config_template",
  "get_quantization_strategy",
  "get_hardware_optimization_guide",
  "get_pass_chain",
  "troubleshoot_olive_error",
  "diagnose_error",
  "get_error_frequency_summary",
  "get_model_compatibility",
  "get_cli_command",
  "get_data_config_template",
  "search_olive_documentation",
  "get_integration_recipe",
  "get_pass_parameters",
  "evaluate_optimization_tradeoff",
  "get_context_for_pipeline",
]);

export function isAllowedMcpToolName(toolName: string): boolean {
  return ALLOWED_MCP_TOOL_NAMES.has(toolName);
}
