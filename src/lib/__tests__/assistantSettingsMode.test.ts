import { describe, expect, it } from "vitest";
import {
  deriveAssistantSettingsMode,
  isLocalEngineBaseUrl,
  preferredEngineFromBaseUrl,
} from "../assistantSettingsMode";

describe("assistantSettingsMode", () => {
  it("detects LM Studio and Ollama loopback URLs", () => {
    expect(isLocalEngineBaseUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalEngineBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalEngineBaseUrl("http://[::1]:11434/v1")).toBe(true);
    expect(isLocalEngineBaseUrl("http://127.0.0.1:8080/v1")).toBe(false);
    expect(isLocalEngineBaseUrl("https://api.openai.com/v1")).toBe(false);
  });

  it("rejects malformed URLs without substring fallback", () => {
    expect(isLocalEngineBaseUrl("localhost:11434%zz")).toBe(false);
    expect(isLocalEngineBaseUrl("not a url")).toBe(false);
  });

  it("derives local mode only for openai-compat + local engine URL", () => {
    expect(deriveAssistantSettingsMode("openai-compat", "http://127.0.0.1:11434/v1")).toBe("local");
    expect(deriveAssistantSettingsMode("openai-compat", "https://api.example.com/v1")).toBe("cloud");
    expect(deriveAssistantSettingsMode("gemini", "http://127.0.0.1:11434/v1")).toBe("cloud");
  });

  it("maps base URL to preferred engine", () => {
    expect(preferredEngineFromBaseUrl("http://127.0.0.1:11434/v1")).toBe("ollama");
    expect(preferredEngineFromBaseUrl("http://127.0.0.1:1234/v1")).toBe("lms");
    expect(preferredEngineFromBaseUrl("https://api.example.com/v1")).toBe(null);
  });
});
