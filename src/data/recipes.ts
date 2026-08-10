import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";

export type RecipeItem = RecipeCatalogItem;

/**
 * Presets tab: full microsoft/olive-recipes catalog.
 *
 * Fetches from the server-side /api/github/catalog endpoint instead of
 * bundling the 192KB static file in the client JS. Falls back to an empty
 * array if the server is unreachable (offline / Tauri edge case).
 *
 * The server loads the same olive-recipes-catalog.ts data and supports
 * pagination, but we fetch all items here for client-side filtering.
 */
let _cachedCatalog: RecipeItem[] | null = null;

export async function loadSuggestedRecipes(): Promise<RecipeItem[]> {
  if (_cachedCatalog) return _cachedCatalog;
  try {
    // Fetch all items from the server (max page size 100, paginate to get all)
    const allItems: RecipeItem[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await fetch(`/api/github/catalog?page=${page}&pageSize=100`);
      if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
      const data = await res.json();
      allItems.push(...data.items);
      totalPages = data.pagination.totalPages;
      page++;
    } while (page <= totalPages);
    _cachedCatalog = allItems;
  } catch {
    // Offline or server unavailable — degrade gracefully with empty catalog
    _cachedCatalog = [];
  }
  return _cachedCatalog;
}

/**
 * Synchronous accessor for backward compatibility.
 * Returns the cached catalog if already loaded, otherwise an empty array.
 * **Do not rely on this in new code** — use `loadSuggestedRecipes()` (async)
 * or the server-side `/api/github/catalog` endpoint instead.
 * This array is populated asynchronously after module load; React components
 * reading it during initial render will see [] until the fetch resolves.
 */
export const SUGGESTED_RECIPES: RecipeItem[] = [];

// Eagerly kick off the fetch so the catalog is warm by the time
// the user opens the recipe browser (non-blocking).
loadSuggestedRecipes().then((items) => {
  // Mutate the exported array in-place so existing consumers see the data.
  SUGGESTED_RECIPES.length = 0;
  SUGGESTED_RECIPES.push(...items);
});
