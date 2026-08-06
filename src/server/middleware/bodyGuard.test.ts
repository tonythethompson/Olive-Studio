import { describe, it, expect } from "vitest";

import { parseBody } from "./bodyGuard.ts";

describe("parseBody", () => {
  it("treats an empty string as missing for required json fields", () => {
    const result = parseBody<{ recipe: unknown }>({ recipe: "" }, {
      recipe: { type: "json", message: "Missing recipe" },
    });

    expect(result).toEqual({ error: "Missing recipe" });
  });

  it("treats an empty string as missing for required string fields", () => {
    const result = parseBody<{ token: string }>({ token: "" }, {
      token: { type: "string" },
    });

    expect(result).toEqual({ error: "token is required and must be a string" });
  });

  it("accepts a non-empty JSON string for json fields", () => {
    const result = parseBody<{ recipe: unknown }>({ recipe: '{"passes":{}}' }, {
      recipe: { type: "json" },
    });

    expect(result).toEqual({ parsed: { recipe: '{"passes":{}}' } });
  });

  it("omits optional json fields when the value is an empty string", () => {
    const result = parseBody<{ note?: unknown }>({ note: "" }, {
      note: { type: "json", required: false },
    });

    expect(result).toEqual({ parsed: {} });
  });
});
