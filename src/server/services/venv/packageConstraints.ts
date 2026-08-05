/**
 * Enforce per-family ORT packageConstraints on capability pip installs.
 *
 * - Rejects install args that name a conflicting onnxruntime* distribution.
 * - Injects a pip --constraint file so transitive deps cannot freely float the
 *   family's canonical ORT pin.
 * - Post-install asserts via listInstalledOrtDistributions.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { ALL_ORT_DISTRIBUTIONS, getFamilySpec, ORT_PLUGIN_PACKAGE_NAMES } from "./spec.ts";
import { listInstalledOrtDistributions } from "./status.ts";

const ORT_PLUGIN_SET = new Set(
  ORT_PLUGIN_PACKAGE_NAMES.map((n) => n.toLowerCase().replace(/[_.-]+/g, "-")),
);
const ORT_DIST_SET = new Set(
  ALL_ORT_DISTRIBUTIONS.map((n) => n.toLowerCase().replace(/[_.-]+/g, "-")),
);

/** Pip flags that take a following value (skip that value when scanning packages). */
const PIP_FLAGS_WITH_VALUE = new Set([
  "-c",
  "--constraint",
  "-r",
  "--requirement",
  "-e",
  "--editable",
  "-f",
  "--find-links",
  "-i",
  "--index-url",
  "--extra-index-url",
  "--trusted-host",
  "--target",
  "--prefix",
  "--root",
  "--src",
  "-b",
  "--build",
  "--no-binary",
  "--only-binary",
  "--progress-bar",
  "--implementation",
  "--python-version",
  "--abi",
  "--platform",
  "--upgrade-strategy",
  "--config-settings",
]);

/** PEP 503 normalize: lowercase + collapse runs of `[_.-]+` to `-`. */
export function normalizeDistName(name: string): string {
  return name.toLowerCase().replace(/[_.-]+/g, "-");
}

/**
 * Extract a distribution name from a pip requirement token.
 * Returns null for flags / URLs / empty tokens.
 */
export function packageNameFromPipArg(arg: string): string | null {
  const trimmed = arg.trim();
  if (!trimmed || trimmed.startsWith("-") || trimmed.includes("://")) return null;
  // package[extra]==1.2.3 / package>=1 → package
  const base = trimmed.split(/[=<>!~\[]/, 1)[0]?.trim();
  return base || null;
}

/**
 * Mutually exclusive ORT wheels only. Plugin packages (onnxruntime-qnn 2.x)
 * are exempt — they install beside standard onnxruntime.
 */
function isOrtDistributionName(name: string): boolean {
  const normalized = normalizeDistName(name);
  if (ORT_PLUGIN_SET.has(normalized)) return false;
  return ORT_DIST_SET.has(normalized);
}

/** Canonical ORT package names allowed by the family's packageConstraints. */
export function allowedOrtPackageNames(family: VenvFamily): Set<string> {
  const names = new Set<string>();
  for (const constraint of getFamilySpec(family).packageConstraints) {
    const name = packageNameFromPipArg(constraint);
    if (name) names.add(normalizeDistName(name));
  }
  return names;
}

/**
 * Scan pip install args for ORT packages that violate the family's constraints.
 * Forbidden when an ORT distribution is not in the family's allowed set.
 */
export function findForbiddenOrtInstallArgs(family: VenvFamily, args: string[]): string[] {
  const allowed = allowedOrtPackageNames(family);
  const forbidden: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("-")) {
      const flag = arg.includes("=") ? arg.split("=", 1)[0]! : arg;
      if (PIP_FLAGS_WITH_VALUE.has(flag) && !arg.includes("=")) i += 1;
      continue;
    }
    const name = packageNameFromPipArg(arg);
    if (!name) continue;
    const normalized = normalizeDistName(name);
    if (isOrtDistributionName(normalized) && !allowed.has(normalized)) {
      forbidden.push(arg);
    }
  }
  return forbidden;
}

/**
 * Prepend a temporary pip --constraint file built from family packageConstraints.
 * Caller must invoke cleanup() when done.
 */
export function withFamilyPipConstraintArgs(
  family: VenvFamily,
  args: string[],
): { args: string[]; cleanup: () => void } {
  const spec = getFamilySpec(family);
  const constraints = [
    ...spec.packageConstraints,
    ...(spec.supplementalConstraints ?? []),
  ];
  // Deduplicate while preserving order.
  const unique = Array.from(new Set(constraints));
  if (unique.length === 0) {
    return { args: [...args], cleanup: () => undefined };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "olive-studio-pip-constraint-"));
  const file = path.join(dir, "constraints.txt");
  const lines = unique.filter((c) => c.trim() && !c.trim().startsWith("-"));
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return {
    args: ["--constraint", file, ...args],
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Assert the live interpreter still matches family ORT packageConstraints.
 * Returns an error message or null when healthy.
 */
export async function assertFamilyOrtConstraints(
  family: VenvFamily,
  python: string,
): Promise<string | null> {
  const spec = getFamilySpec(family);
  const dists = (await listInstalledOrtDistributions(python)).map(normalizeDistName);
  const canonical = normalizeDistName(spec.ortDistribution);
  if (!dists.includes(canonical)) {
    return `${family} runtime missing canonical ORT (${spec.ortDistribution}); packageConstraints violated`;
  }
  const conflicting = dists.filter(
    (d) => d !== canonical && isOrtDistributionName(d),
  );
  if (conflicting.length > 0) {
    return `${family} runtime has conflicting ORT distributions: ${conflicting.join(", ")} (allowed: ${spec.packageConstraints.join(", ")})`;
  }
  return null;
}

/**
 * Guard install args against family packageConstraints before spawning pip.
 * Throws when forbidden ORT packages are requested.
 */
export function enforcePackageConstraintsOrThrow(family: VenvFamily, args: string[]): void {
  const forbidden = findForbiddenOrtInstallArgs(family, args);
  if (forbidden.length === 0) return;
  const allowed = getFamilySpec(family).packageConstraints.join(", ");
  throw new Error(
    `Refusing to install ORT packages incompatible with ${family} runtime constraints: ${forbidden.join(", ")}. Allowed: ${allowed}`,
  );
}
