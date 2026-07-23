import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";

export type RecipeMatchTier = "match" | "possible" | "none";

export interface LocalModelHints {
  fileNames: string[];
  /** Best-effort label for UI (from config.json or filenames). */
  displayName: string;
  hfModelIds: string[];
  architectureHints: string[];
  /** Normalized slug candidates for catalog folder matching. */
  slugCandidates: string[];
}

export interface RecipeMatchResult {
  score: number;
  tier: RecipeMatchTier;
  reason: string;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hfIdToCatalogSlug(hfId: string): string {
  const trimmed = hfId.trim();
  if (!trimmed) return "";
  if (trimmed.includes("/")) {
    const [org, name] = trimmed.split("/");
    if (org && name) return `${org}-${name}`;
  }
  return trimmed;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[-_./\s]+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length >= 2),
  );
}

function tokenOverlapRatio(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }
  return shared / Math.min(setA.size, setB.size);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function getCatalogFolderSlug(repoPath: string): string {
  return repoPath.split("/")[0] ?? "";
}

export function parseLocalModelHintsFromConfig(
  configText: string,
): Pick<LocalModelHints, "hfModelIds" | "architectureHints"> {
  try {
    const json = JSON.parse(configText) as Record<string, unknown>;
    const hfModelIds: string[] = [];
    const architectureHints: string[] = [];

    const pushString = (value: unknown) => {
      if (typeof value === "string" && value.trim()) hfModelIds.push(value.trim());
    };

    pushString(json._name_or_path);
    pushString(json.name);
    pushString(json.model_name);

    const hfConfig = json.hf_config;
    if (hfConfig && typeof hfConfig === "object") {
      pushString((hfConfig as Record<string, unknown>).model_name);
    }

    if (Array.isArray(json.architectures)) {
      for (const arch of json.architectures) {
        if (typeof arch === "string" && arch.trim()) architectureHints.push(arch.trim());
      }
    }

    return {
      hfModelIds: uniqueStrings(hfModelIds),
      architectureHints: uniqueStrings(architectureHints),
    };
  } catch {
    return { hfModelIds: [], architectureHints: [] };
  }
}

export function buildLocalModelHints(fileNames: string[], configText?: string): LocalModelHints {
  const parsed = configText
    ? parseLocalModelHintsFromConfig(configText)
    : { hfModelIds: [], architectureHints: [] };

  const slugCandidates = uniqueStrings([
    ...parsed.hfModelIds.map(hfIdToCatalogSlug),
    ...parsed.hfModelIds,
    ...fileNames
      .map((name) => name.replace(/\.[^.]+$/, ""))
      .filter(
        (base) =>
          base.length > 3 &&
          !["config", "tokenizer", "model", "pytorch_model", "tokenizer_config"].includes(base.toLowerCase()),
      ),
  ]);

  const displayName =
    parsed.hfModelIds[0]?.split("/").pop() ??
    slugCandidates[0]?.split("-").slice(-3).join("-") ??
    fileNames[0]?.replace(/\.[^.]+$/, "") ??
    "Local upload";

  return {
    fileNames,
    displayName,
    hfModelIds: parsed.hfModelIds,
    architectureHints: parsed.architectureHints,
    slugCandidates,
  };
}

export function scoreRecipeMatchForLocal(hints: LocalModelHints, item: RecipeCatalogItem): RecipeMatchResult {
  const catalogSlug = getCatalogFolderSlug(item.repoPath);
  const catalogNorm = normalizeToken(catalogSlug);
  let bestScore = 0;
  let bestReason = "No overlap with uploaded model";

  for (const candidate of hints.slugCandidates) {
    const candNorm = normalizeToken(candidate);
    if (!candNorm) continue;

    if (catalogNorm === candNorm) {
      return { score: 100, tier: "match", reason: `Folder matches ${catalogSlug}` };
    }

    if (catalogNorm.includes(candNorm) || candNorm.includes(catalogNorm)) {
      const score = 85;
      if (score > bestScore) {
        bestScore = score;
        bestReason = `Name overlap with ${catalogSlug}`;
      }
      continue;
    }

    const overlap = tokenOverlapRatio(catalogSlug, candidate);
    if (overlap >= 0.55) {
      const score = 70 + Math.round(overlap * 20);
      if (score > bestScore) {
        bestScore = score;
        bestReason = `Shared tokens with ${catalogSlug}`;
      }
    } else if (overlap >= 0.35) {
      const score = 45 + Math.round(overlap * 20);
      if (score > bestScore) {
        bestScore = score;
        bestReason = `Partial overlap with ${catalogSlug}`;
      }
    }
  }

  for (const arch of hints.architectureHints) {
    if (normalizeToken(item.architecture) === normalizeToken(arch)) {
      bestScore = Math.max(bestScore, 42);
      bestReason = `Architecture hint: ${arch}`;
    }
  }

  const tier: RecipeMatchTier = bestScore >= 65 ? "match" : bestScore >= 40 ? "possible" : "none";

  return { score: bestScore, tier, reason: bestReason };
}

export function summarizeLocalRecipeMatches(
  hints: LocalModelHints,
  catalog: RecipeCatalogItem[],
): { match: number; possible: number; none: number } {
  let match = 0;
  let possible = 0;
  let none = 0;
  for (const item of catalog) {
    const tier = scoreRecipeMatchForLocal(hints, item).tier;
    if (tier === "match") match += 1;
    else if (tier === "possible") possible += 1;
    else none += 1;
  }
  return { match, possible, none };
}
