import { describe, it, expect } from "vitest";
import {
  getChatScopeBlock,
  isClearlyOffTopicOliveChat,
  normalizeChatForScope,
  OLIVE_ABUSE_REFUSAL,
  OLIVE_SAFETY_REFUSAL,
  OLIVE_SCOPE_REFUSAL,
} from "./chatScope.ts";

describe("normalizeChatForScope", () => {
  it("folds leetspeak and separators", () => {
    expect(normalizeChatForScope("f.u.c.k")).toContain("fuck");
    expect(normalizeChatForScope("f u c k")).toContain("fuck");
    expect(normalizeChatForScope("sh1t")).toContain("shit");
    expect(normalizeChatForScope("n1gg3r")).toMatch(/nigger|niger/);
  });
});

describe("getChatScopeBlock", () => {
  it("blocks clear off-topic questions", () => {
    expect(getChatScopeBlock("where do babies come from")?.reason).toBe("off_topic");
    expect(getChatScopeBlock("yes help, where do babies come from")?.reason).toBe("off_topic");
    expect(isClearlyOffTopicOliveChat("where do babies come from")).toBe(true);
  });

  it("blocks pure profanity and hard abuse when not Olive-scoped", () => {
    expect(getChatScopeBlock("fuck this")?.reason).toBe("abuse");
    expect(getChatScopeBlock("f.u.c.k you")?.reason).toBe("abuse");
    expect(getChatScopeBlock("send nudes")?.reason).toBe("abuse");
    expect(getChatScopeBlock("you are a n1gg3r")?.reason).toBe("abuse");
    expect(getChatScopeBlock("kill all faggots")?.reason).toBe("abuse");
  });

  it("ignores colorful swearing on Olive-scoped questions", () => {
    expect(
      getChatScopeBlock("this fuckin bitch of a model is too goddamn big, how do I shrink this stupid ho"),
    ).toBeNull();
    expect(getChatScopeBlock("this olive awq path is fucking stupid")).toBeNull();
  });

  it("still blocks hate / sexual content even when Olive keywords are present", () => {
    expect(getChatScopeBlock("olive awq for n1gg3r models")?.reason).toBe("abuse");
    expect(getChatScopeBlock("send nudes about this onnx recipe")?.reason).toBe("abuse");
  });

  it("blocks suicidal, dangerous, and obsessive harm topics (even if Olive-scoped)", () => {
    expect(getChatScopeBlock("I want to kill myself")?.reason).toBe("safety");
    expect(getChatScopeBlock("how do I end my life after this olive run")?.reason).toBe("safety");
    expect(getChatScopeBlock("how to make a bomb")?.reason).toBe("safety");
    expect(getChatScopeBlock("how do I stalk my coworker")?.reason).toBe("safety");
  });

  it("blocks hyphenated safety / dangerous phrases after separator normalization", () => {
    expect(normalizeChatForScope("kill-myself")).toContain("kill myself");
    expect(getChatScopeBlock("kill-myself")?.reason).toBe("safety");
    expect(getChatScopeBlock("how-to-make-a-bomb")?.reason).toBe("safety");
  });

  it("blocks explicit off-topic even when a generic Olive keyword matches", () => {
    expect(getChatScopeBlock("recipe for cake")?.reason).toBe("off_topic");
  });

  it("does not treat process/debug language as safety hits", () => {
    expect(getChatScopeBlock("how do I kill the stuck olive pipeline process?")).toBeNull();
    expect(getChatScopeBlock("is activation data poisoning a concern for AWQ?")).toBeNull();
  });

  it("allows Olive / optimization questions", () => {
    expect(getChatScopeBlock("Why would I choose AWQ over QAT?")).toBeNull();
    expect(getChatScopeBlock("Is int4 ok for TensorRT RTX on this GPU?")).toBeNull();
    expect(getChatScopeBlock("How do I set the Olive recipe opset?")).toBeNull();
  });

  it("does not treat Olive questions as off-topic when they share a common word", () => {
    expect(getChatScopeBlock("Does Olive support QAT for calibration steps?")?.reason).not.toBe("off_topic");
  });
});

describe("refusal copy", () => {
  it("mentions Olive Studio / professionalism / crisis resources", () => {
    expect(OLIVE_SCOPE_REFUSAL).toMatch(/Olive Studio/);
    expect(OLIVE_ABUSE_REFUSAL).toMatch(/professional/i);
    expect(OLIVE_SAFETY_REFUSAL).toMatch(/988/);
    expect(OLIVE_SAFETY_REFUSAL).toMatch(/iasp\.info/i);
  });
});
