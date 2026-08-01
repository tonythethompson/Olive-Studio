import { useState, useEffect, useRef } from "react";
import type { ChatAction } from "@/lib/chatActions";
import { sanitizeChatActionPatch } from "@/lib/chatActions";

export interface ChatMessage {
  sender: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
  appliedActionIds?: string[];
}

const GREETING: ChatMessage = {
  sender: "assistant",
  text: "Hello! I'm your **Olive Studio assistant**. I read your **live workspace**: model source, hardware target, passes, validation issues, and batch queue, and use that as context for every reply.\n\nUse the quick queries below (they update as you change the pipeline) or ask anything about optimization.",
};

/**
 * Owns the assistant chat transcript, the composer input, and the
 * `/api/ai/chat` round-trip (workspace context is sent with every message).
 */
export function useAiChat(workspaceContext: unknown) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([GREETING]);
  const [inputQuestion, setInputQuestion] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatting]);

  const sendChat = async (presetText?: string) => {
    const text = presetText || inputQuestion;
    if (!text.trim()) return;

    const userMessage: ChatMessage = { sender: "user", text };
    setChatMessages((prev) => [...prev, userMessage]);
    if (!presetText) setInputQuestion("");
    setIsChatting(true);
    setChatError("");
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          workspaceContext,
          // Prior turns only: the route appends `message` onto chatHistory for the LLM.
          chatHistory: chatMessages.map((m) => ({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.text,
          })),
        }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await r.json().catch(() => ({})) : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      if (!contentType.includes("application/json")) {
        throw new Error(
          "Server returned non-JSON. Restart with npm run dev (Express + API), not vite alone.",
        );
      }
      const replyText =
        (data as { reply?: string; text?: string }).reply?.trim() ||
        (data as { reply?: string; text?: string }).text?.trim() ||
        "No response generated.";
      const rawActions = Array.isArray((data as { actions?: unknown }).actions)
        ? (data as { actions: unknown[] }).actions
        : [];
      const actions: ChatAction[] = [];
      for (let i = 0; i < rawActions.length && actions.length < 5; i++) {
        const row = rawActions[i];
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        const patch = sanitizeChatActionPatch(rec.patch);
        if (!patch) continue;
        actions.push({
          id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `action-${i}-${Date.now()}`,
          title:
            (typeof rec.title === "string" && rec.title.trim()) ||
            (typeof rec.label === "string" && rec.label.trim()) ||
            "Apply change",
          patch,
        });
      }
      setChatMessages((prev) => [
        ...prev,
        { sender: "assistant", text: replyText, actions: actions.length ? actions : undefined },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setChatError(err.message || "Chat request failed.");
    } finally {
      setIsChatting(false);
    }
  };

  const markActionApplied = (messageIndex: number, actionId: string) => {
    setChatMessages((prev) =>
      prev.map((msg, i) => {
        if (i !== messageIndex) return msg;
        const applied = new Set(msg.appliedActionIds ?? []);
        applied.add(actionId);
        return { ...msg, appliedActionIds: [...applied] };
      }),
    );
  };

  return {
    chatMessages,
    inputQuestion,
    setInputQuestion,
    isChatting,
    chatError,
    chatEndRef,
    sendChat,
    markActionApplied,
  };
}
