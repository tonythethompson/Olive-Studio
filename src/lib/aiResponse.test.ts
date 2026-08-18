import { describe, it, expect, afterEach } from "vitest";
import {
  isPlaceholderEnvValue,
  matchedEnvApiKeyName,
  parseJsonFromAiResponse,
  readEnvApiKey,
  softRepairJson,
} from "./aiResponse.ts";

describe("readEnvApiKey / matchedEnvApiKeyName", () => {
  const keys = ["TEST_OLIVE_API_KEY_A", "TEST_OLIVE_API_KEY_B"] as const;

  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it("ignores placeholders and empty values", () => {
    process.env.TEST_OLIVE_API_KEY_A = "your_key_here";
    expect(isPlaceholderEnvValue("your_key_here")).toBe(true);
    expect(readEnvApiKey(...keys)).toBeUndefined();
    expect(matchedEnvApiKeyName(...keys)).toBeUndefined();
  });

  it("returns the first real key and its env var name", () => {
    process.env.TEST_OLIVE_API_KEY_A = "sk-real-value";
    process.env.TEST_OLIVE_API_KEY_B = "sk-other";
    expect(readEnvApiKey(...keys)).toBe("sk-real-value");
    expect(matchedEnvApiKeyName(...keys)).toBe("TEST_OLIVE_API_KEY_A");
  });

  it("falls through to the next name when the first is missing", () => {
    process.env.TEST_OLIVE_API_KEY_B = "sk-second";
    expect(matchedEnvApiKeyName(...keys)).toBe("TEST_OLIVE_API_KEY_B");
  });
});

describe("parseJsonFromAiResponse", () => {
  it("parses fenced JSON", () => {
    expect(parseJsonFromAiResponse('```json\n{"score":1}\n```')).toEqual({ score: 1 });
  });

  it("repairs trailing commas and missing commas between objects", () => {
    const raw = `{
  "score": 70,
  "suggestions": [
    { "title": "a" },
    { "title": "b", }
  ],
}`;
    expect(softRepairJson(raw)).not.toMatch(/,\s*]/);
    const parsed = parseJsonFromAiResponse(raw) as { score: number; suggestions: unknown[] };
    expect(parsed.score).toBe(70);
    expect(parsed.suggestions).toHaveLength(2);
  });

  it("repairs missing commas between adjacent objects in an array", () => {
    const raw = `{"suggestions":[{"title":"a"}{"title":"b"}]}`;
    const parsed = parseJsonFromAiResponse(raw) as { suggestions: Array<{ title: string }> };
    expect(parsed.suggestions.map((s) => s.title)).toEqual(["a", "b"]);
  });

  it("extracts JSON when prose precedes a balanced object", () => {
    const parsed = parseJsonFromAiResponse(
      'Here is the analysis:\n{"score":88,"level":"Optimized","summary":"ok","suggestions":[]}',
    ) as { score: number };
    expect(parsed.score).toBe(88);
  });

  it("prefers explicit ```json block over earlier non-JSON code blocks", () => {
    const text = `Here is a python snippet:
\`\`\`python
import olive
print("not json")
\`\`\`

And here is the recommendation:
\`\`\`json
{
  "reply": "Optimized",
  "actions": []
}
\`\`\``;
    const parsed = parseJsonFromAiResponse(text) as { reply: string };
    expect(parsed.reply).toBe("Optimized");
  });

  it("finds parsable JSON among multiple untagged fenced blocks", () => {
    const text = `Sample code:
\`\`\`
const a = 1;
const b = 2;
\`\`\`

Configuration payload:
\`\`\`
{
  "score": 95
}
\`\`\``;
    const parsed = parseJsonFromAiResponse(text) as { score: number };
    expect(parsed.score).toBe(95);
  });

  it("prefers balanced JSON in prose over non-JSON code block fallback", () => {
    const text = `Sample snippet:
\`\`\`bash
echo 123
\`\`\`

And the structured analysis:
{
  "score": 99,
  "level": "Optimized"
}`;
    const parsed = parseJsonFromAiResponse(text) as { score: number; level: string };
    expect(parsed.score).toBe(99);
    expect(parsed.level).toBe("Optimized");
  });
});
