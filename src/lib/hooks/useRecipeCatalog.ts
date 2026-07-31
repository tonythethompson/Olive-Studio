/**
 * Hook for lazy-loading the recipe catalog from the server-side paginated endpoint.
 * Requires the Express server to be running; surfaces an error state if the
 * server is unavailable (callers may fall back to `loadSuggestedRecipes()`).
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";

interface CatalogPage {
  items: RecipeCatalogItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface UseRecipeCatalogOptions {
  arch?: string;
  device?: string;
  pageSize?: number;
  enabled?: boolean;
}

export function useRecipeCatalog(options: UseRecipeCatalogOptions = {}) {
  const { arch, device, pageSize = 50, enabled = true } = options;

  return useInfiniteQuery<CatalogPage>({
    queryKey: ["recipe-catalog", arch, device, pageSize],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        page: String(pageParam),
        pageSize: String(pageSize),
      });
      if (arch) params.set("arch", arch);
      if (device) params.set("device", device);

      const response = await fetch(`/api/github/catalog?${params.toString()}`, { signal });
      if (!response.ok) {
        throw new Error(`Catalog fetch failed (HTTP ${response.status})`);
      }
      return response.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages ? lastPage.pagination.page + 1 : undefined,
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Flatten all pages into a single array of catalog items.
 */
export function flattenCatalogPages(pages: CatalogPage[] | undefined): RecipeCatalogItem[] {
  if (!pages) return [];
  return pages.flatMap((p) => p.items);
}
