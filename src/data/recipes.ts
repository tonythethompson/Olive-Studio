import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";

export type RecipeItem = RecipeCatalogItem;

/**
 * Presets tab: full microsoft/olive-recipes catalog.
 * Lazy-loaded via dynamic import so Vite code-splits the 215KB bundle
 * out of the initial chunk. Falls back to an empty array if the import
 * fails (offline / Tauri edge case) — the server-side /api/github/catalog
 * endpoint is the primary source in production.
 */
let _cachedCatalog: RecipeItem[] | null = null;

export async function loadSuggestedRecipes(): Promise<RecipeItem[]> {
  if (_cachedCatalog) return _cachedCatalog;
  try {
    const mod = await import("./olive-recipes-catalog");
    _cachedCatalog = mod.OLIVE_RECIPES_CATALOG;
  } catch {
    _cachedCatalog = [];
  }
  return _cachedCatalog;
}

/**
 * Synchronous accessor for backward compatibility.
 * Returns the cached catalog if already loaded, otherwise an empty array.
 * Prefer `loadSuggestedRecipes()` for new code.
 */
export const SUGGESTED_RECIPES: RecipeItem[] = [];

// Eagerly kick off the dynamic import so the catalog is warm by the time
// the user opens the recipe browser (non-blocking).
loadSuggestedRecipes().then((items) => {
  // Mutate the exported array in-place so existing consumers see the data.
  SUGGESTED_RECIPES.length = 0;
  SUGGESTED_RECIPES.push(...items);
});
