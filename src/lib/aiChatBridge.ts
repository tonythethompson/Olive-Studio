export const OLIVE_ASK_AI_CHAT = "olive-studio:ask-ai-chat";

export interface AskAiChatDetail {
  query: string;
  /** Unique per dispatch so the same query text can be re-sent and still trigger the listener. */
  nonce: number;
}

/**
 * Opens the Assistant chat panel and sends `query` as a user message, so the
 * user reads the AI's reasoning and applies (or ignores) any proposed change
 * themselves, instead of a UI control silently writing pipeline state.
 */
export function askAiChat(query: string): void {
  window.dispatchEvent(
    new CustomEvent<AskAiChatDetail>(OLIVE_ASK_AI_CHAT, { detail: { query, nonce: Date.now() } }),
  );
}
