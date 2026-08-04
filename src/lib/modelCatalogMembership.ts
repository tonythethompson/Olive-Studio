export type ModelCatalogSource = "live" | "fallback";

export type ModelCatalogMembership =
  | { status: "empty" }
  | { status: "unknown-source" }
  | { status: "in-catalog"; source: ModelCatalogSource }
  | { status: "not-in-catalog"; source: ModelCatalogSource };

/**
 * Soft membership check against a fetched (or fallback) model catalog.
 * Does not prove the endpoint will accept the id; only whether it appears in the list we know about.
 */
export function getModelCatalogMembership(
  modelId: string,
  catalog: ReadonlyArray<{ id: string }>,
  source: ModelCatalogSource | null,
): ModelCatalogMembership {
  const trimmed = modelId.trim();
  if (!trimmed) return { status: "empty" };
  if (!source) return { status: "unknown-source" };
  if (catalog.some((m) => m.id === trimmed)) {
    return { status: "in-catalog", source };
  }
  return { status: "not-in-catalog", source };
}

/** Short status copy for the model picker membership badge. Warning-only. */
export function modelCatalogMembershipLabel(membership: ModelCatalogMembership): string | null {
  switch (membership.status) {
    case "empty":
    case "unknown-source":
    case "in-catalog":
      return null;
    case "not-in-catalog":
      return "Model ID not recognized. Requests may fail.";
    default: {
      const _exhaustive: never = membership;
      return _exhaustive;
    }
  }
}
