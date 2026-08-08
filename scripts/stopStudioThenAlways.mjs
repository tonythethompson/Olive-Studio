/**
 * Ensure Studio shutdown always runs config/temp cleanup afterward.
 * Used by mcp-agent-smoke so a stopStudio rejection cannot skip restore.
 *
 * @template T
 * @param {() => Promise<T> | T} stopStudio
 * @param {() => Promise<void> | void} afterStop
 * @returns {Promise<T | undefined>}
 */
export async function stopStudioThenAlways(stopStudio, afterStop) {
  try {
    return await stopStudio();
  } finally {
    await afterStop();
  }
}
