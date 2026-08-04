import { describe, expect, it } from "vitest";
import {
  OPEN_VINO_PIP_PACKAGE,
  OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE,
  openvinoStackInstallArgs,
  openvinoStackLabel,
} from "./openvinoDeps.ts";

describe("openvinoStackInstallArgs", () => {
  it("includes --upgrade-strategy eager and both packages", () => {
    const args = openvinoStackInstallArgs();
    expect(args).toContain("--upgrade-strategy");
    expect(args).toContain("eager");
    expect(args).toContain(OPEN_VINO_PIP_PACKAGE);
    expect(args).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
  });

  it("does not split the bracketed extra into a bare token", () => {
    const args = openvinoStackInstallArgs();
    expect(args.some((a) => a.startsWith("["))).toBe(false);
    expect(args).toContain(`${OPEN_VINO_PIP_PACKAGE}`);
    expect(args).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
  });

  it("labels the stack for UI/logs", () => {
    expect(openvinoStackLabel()).toContain(OPEN_VINO_PIP_PACKAGE);
    expect(openvinoStackLabel()).toContain(OPTIMUM_INTEL_OPEN_VINO_PIP_PACKAGE);
  });
});
