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
  // Write-capable / studio bridge tools: HTTP proxy is loopback-only (mcpToolLocalOnly).
  "validate_ui_state_recipe",
  "get_recipe_for_ui_state",
  "get_runtime_ep_hints",
  "record_troubleshoot_feedback",
  // Phase 0 capability discovery (not transport health).
  "get_mcp_capabilities",
  // Phase 2–3: Studio job tools (submit/cancel policy-gated on Studio).
  "list_optimization_jobs",
  "get_optimization_job",
  "get_optimization_results",
  "validate_optimization_job",
  "submit_optimization_job",
  "cancel_optimization_job",
  // Phase 3: Agent autonomous-loop tools.
  "execute_and_observe",
  "plan_optimization",
  "diagnose_and_fix",
  "compare_results",
  "get_model_info",
]);

/**
 * Determines whether an MCP tool name is allowed.
 *
 * @param toolName - The MCP tool name to check
 * @returns `true` if the tool name is allowed, `false` otherwise
 */
export function isAllowedMcpToolName(toolName: string): boolean {
  return ALLOWED_MCP_TOOL_NAMES.has(toolName);
}
