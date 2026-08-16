import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Side-effect import (registration) + named import in one statement.
import { parsePackedCredentials } from "./bedrock.ts";
import { getProvider } from "./registry.ts";

describe("parsePackedCredentials", () => {
  it("parses a two-segment static credential", () => {
    expect(parsePackedCredentials("AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI")).toEqual({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI",
    });
  });

  it("parses a three-segment temporary credential with session token", () => {
    expect(parsePackedCredentials("ASIAEXAMPLE:secret:sessionToken123")).toEqual({
      accessKeyId: "ASIAEXAMPLE",
      secretAccessKey: "secret",
      sessionToken: "sessionToken123",
    });
  });

  it("drops a blank trailing session token", () => {
    expect(parsePackedCredentials("AKIAEXAMPLE:secret:  ")).toEqual({
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
    });
  });
});

describe("bedrock buildConfig", () => {
  const saved = {
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    token: process.env.AWS_SESSION_TOKEN,
    region: process.env.AWS_REGION,
  };

  beforeEach(() => {
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AWS_REGION;
  });

  afterEach(() => {
    if (saved.secret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
    else process.env.AWS_SECRET_ACCESS_KEY = saved.secret;
    if (saved.token === undefined) delete process.env.AWS_SESSION_TOKEN;
    else process.env.AWS_SESSION_TOKEN = saved.token;
    if (saved.region === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = saved.region;
  });

  it("packs access key and secret for static credentials", () => {
    process.env.AWS_SECRET_ACCESS_KEY = "staticSecret";
    const cfg = getProvider("bedrock")!.buildConfig("AKIAEXAMPLE");
    expect(cfg.apiKey).toBe("AKIAEXAMPLE:staticSecret");
  });

  it("packs AWS_SESSION_TOKEN as a third segment for assumed-role credentials", () => {
    process.env.AWS_SECRET_ACCESS_KEY = "tempSecret";
    process.env.AWS_SESSION_TOKEN = "tempToken";
    const cfg = getProvider("bedrock")!.buildConfig("ASIAEXAMPLE");
    expect(cfg.apiKey).toBe("ASIAEXAMPLE:tempSecret:tempToken");
  });

  it("round-trips packed temporary credentials through the parser", () => {
    process.env.AWS_SECRET_ACCESS_KEY = "tempSecret";
    process.env.AWS_SESSION_TOKEN = "tempToken";
    const cfg = getProvider("bedrock")!.buildConfig("ASIAEXAMPLE");
    expect(parsePackedCredentials(cfg.apiKey)).toEqual({
      accessKeyId: "ASIAEXAMPLE",
      secretAccessKey: "tempSecret",
      sessionToken: "tempToken",
    });
  });
});
