/**
 * Shared helpers for AI provider model catalogs.
 * Prefer live API lists; filter out non-chat modalities so dropdowns stay usable.
 */

export type CatalogModel = { id: string; label: string };

/** Ids that are almost never valid chat/completions targets. */
const NON_CHAT_ID =
  /(?:^|[/_.-])(embed(?:ding)?s?|embedqa|rerank(?:er)?|retriev(?:e|al)|whisper|tts|asr|speech(?:-to-text)?|diffusion|stable-diffusion|sdxl|text-to-image|image-to-image|image-generation|dall-e|gpt-image|imagen|flux\.?1|moderation|transcribe|coding-embedding|nv-embed\w*|e5-(?:large|v\d)|bge-\w+)(?:$|[/_.-])/i;

export function isLikelyChatModelId(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  return !NON_CHAT_ID.test(trimmed);
}

type OpenAiCompatArchitecture = {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
};

export type OpenAiCompatModelRow = {
  id?: string;
  name?: string;
  architecture?: OpenAiCompatArchitecture;
};

/** OpenRouter / similar rows sometimes expose modality metadata. */
export function openAiCompatRowIsChat(row: OpenAiCompatModelRow): boolean {
  const id = (row.id ?? "").trim();
  if (!isLikelyChatModelId(id)) return false;

  const modality = (row.architecture?.modality ?? "").toLowerCase();
  if (modality) {
    if (modality.includes("embedding")) return false;
    if (modality.includes("->image") && !modality.includes("->text")) return false;
    if (modality.endsWith("->embedding")) return false;
  }

  const outputs = row.architecture?.output_modalities ?? [];
  if (outputs.length > 0 && !outputs.some((o) => /text/i.test(o))) return false;

  return true;
}

export function normalizeCatalogModels(models: Array<{ id: string; label?: string }>): CatalogModel[] {
  const seen = new Set<string>();
  const out: CatalogModel[] = [];
  for (const m of models) {
    const id = m.id.trim();
    if (!id || seen.has(id)) continue;
    if (!isLikelyChatModelId(id)) continue;
    seen.add(id);
    out.push({ id, label: (m.label ?? id).trim() || id });
  }
  return out;
}

export function catalogModelsFromOpenAiCompatRows(rows: OpenAiCompatModelRow[]): CatalogModel[] {
  return normalizeCatalogModels(
    rows
      .filter(openAiCompatRowIsChat)
      .map((m) => ({ id: (m.id ?? "").trim(), label: (m.name ?? m.id ?? "").trim() })),
  );
}

/** Prefer an in-catalog selection; otherwise first live id (or empty). */
export function resolveCatalogSelection(
  currentIds: Array<string | undefined | null>,
  catalog: CatalogModel[],
): { nextId: string; staleId: string | null } {
  if (catalog.length === 0) {
    const stale = currentIds.find((id) => Boolean(id?.trim()))?.trim() || null;
    return { nextId: "", staleId: stale };
  }
  for (const raw of currentIds) {
    const id = raw?.trim();
    if (id && catalog.some((m) => m.id === id)) {
      return { nextId: id, staleId: null };
    }
  }
  const stale =
    currentIds.map((id) => id?.trim()).find((id) => id && !catalog.some((m) => m.id === id)) || null;
  return { nextId: catalog[0]!.id, staleId: stale };
}
