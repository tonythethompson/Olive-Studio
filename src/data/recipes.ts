import { OLIVE_RECIPES_CATALOG } from "./olive-recipes-catalog";
import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";

export type RecipeItem = RecipeCatalogItem;

/** Starter Curated tab: full microsoft/olive-recipes catalog (lazy-loaded from GitHub on apply). */
export const SUGGESTED_RECIPES: RecipeItem[] = OLIVE_RECIPES_CATALOG;
