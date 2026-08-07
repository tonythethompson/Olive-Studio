/**
 * Guardrail: never surface the parenthetical "(not a model)" in product copy.
 * That phrasing is unhelpful in the Assistant provider dropdown (and elsewhere).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDER_OPTIONS } from "@/components/features/gemini/aiProviderCatalog";

const BANNED = "(not a model)";

/** Walk source under `src/`, skipping tests and heavy/generated trees. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (
      name === "node_modules" ||
      name === "dist" ||
      name === "coverage" ||
      name === "__tests__" ||
      name === "storybook-static"
    ) {
      continue;
    }
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx|md|json)$/i.test(name)) continue;
    if (/\.test\.(ts|tsx)$/i.test(name)) continue;
    if (/\.integration\.test\./i.test(name)) continue;
    out.push(full);
  }
  return out;
}

describe('copy ban: "(not a model)"', () => {
  it("is absent from all Assistant provider catalog strings", () => {
    for (const p of PROVIDER_OPTIONS) {
      const blob = [p.id, p.name, p.description ?? "", p.docsUrl, p.keyEnvVar, ...p.models].join("\n");
      expect(blob.toLowerCase(), `provider ${p.id}`).not.toContain(BANNED);
    }
  });

  it("is absent from src source files (UI + docs + comments)", () => {
    const srcRoot = path.resolve(import.meta.dirname, "../..");
    const hits: string[] = [];
    for (const file of listSourceFiles(srcRoot)) {
      const text = readFileSync(file, "utf8");
      if (text.includes(BANNED)) {
        hits.push(path.relative(srcRoot, file).replace(/\\/g, "/"));
      }
    }
    expect(hits, `Banned phrase found in:\n${hits.join("\n")}`).toEqual([]);
  });
});

describe("Assistant provider catalog descriptions", () => {
  it("does not rely on description suffixes in the provider dropdown", () => {
    // Dropdown renders names only; descriptions are optional metadata.
    for (const p of PROVIDER_OPTIONS) {
      expect(p.name.trim(), `${p.id}: empty name`).not.toBe("");
      expect(p.name, `${p.id}: name should not embed a colon suffix`).not.toMatch(/: /);
    }
  });
});
