/**
 * Pass migration mapping for olive-ai version upgrades.
 *
 * Handles:
 *  - Pass name renames (MobiusModelBuilder → MobiusBuilder)
 *  - Pass removals (QairtPreparation, QairtGenAIBuilder)
 *  - Parameter renames (none for 0.13.0, but infrastructure ready)
 *
 * @module passMigration
 */
import type { UIState } from "@/types";

// ─── Migration Types ──────────────────────────────────────────

/** A renamed pass parameter. */
export interface ParamMigration {
  passType: string;
  oldParam: string;
  newParam: string;
  /** Optional value transform (e.g. unit conversion). */
  transformValue?: (value: unknown) => unknown;
  since: string;
}

/** A renamed or removed pass. `newName: null` means the pass was deleted. */
export interface PassNameMigration {
  oldName: string;
  newName: string | null;
  since: string;
}

export interface MigrationResult {
  state: UIState;
  /** Pass names that were renamed (old → new). */
  renamedPasses: Array<{ oldName: string; newName: string }>;
  /** Pass names that were removed (no replacement). */
  removedPasses: string[];
  /** Count of parameters migrated. */
  migratedParams: number;
  /** Count of parameters discarded (transform error). */
  discardedParams: number;
}

// ─── Migration Tables ─────────────────────────────────────────

export interface MigrationTables {
  passNameMigrations: readonly PassNameMigration[];
  paramMigrations: readonly ParamMigration[];
}

const PASS_NAME_MIGRATION_ROWS = [
  { oldName: "MobiusModelBuilder", newName: "MobiusBuilder", since: "0.13.0" },
  { oldName: "QairtPreparation", newName: null, since: "0.13.0" },
  { oldName: "QairtGenAIBuilder", newName: null, since: "0.13.0" },
] as const satisfies readonly PassNameMigration[];

const PARAM_MIGRATION_ROWS = [] as const satisfies readonly ParamMigration[];

const DEFAULT_MIGRATION_TABLES: MigrationTables = Object.freeze({
  passNameMigrations: Object.freeze([...PASS_NAME_MIGRATION_ROWS]),
  paramMigrations: Object.freeze([...PARAM_MIGRATION_ROWS]),
});

/** Frozen pass rename/removal table for production migrations. */
export const PASS_NAME_MIGRATIONS = DEFAULT_MIGRATION_TABLES.passNameMigrations;

/**
 * Frozen parameter rename table.
 * Empty for 0.13.0 — no confirmed param renames. Property tests inject synthetic
 * rows via `applyMigrations(state, { ...DEFAULT_MIGRATION_TABLES, paramMigrations })`.
 */
export const PARAM_MIGRATIONS = DEFAULT_MIGRATION_TABLES.paramMigrations;

// ─── Migration Logic ──────────────────────────────────────────

/**
 * Apply all pending migrations to a loaded UIState.
 *
 * - Renames pass keys in `passRecipeOverrides`
 * - Removes deleted passes from `passRecipeOverrides`
 * - Renames parameters within override objects
 * - Catches transform errors and discards the parameter with a warning
 *
 * The function is idempotent: applying it twice yields the same result.
 */
export function applyMigrations(
  state: UIState,
  tables: MigrationTables = DEFAULT_MIGRATION_TABLES,
): MigrationResult {
  const renamedPasses: MigrationResult["renamedPasses"] = [];
  const removedPasses: string[] = [];
  let migratedParams = 0;
  let discardedParams = 0;

  // Deep-clone overrides to avoid mutation.
  const overrides: Record<string, Record<string, unknown>> = state.passRecipeOverrides
    ? structuredClone(state.passRecipeOverrides)
    : {};

  // 1. Apply pass name migrations to passRecipeOverrides keys.
  for (const migration of tables.passNameMigrations) {
    if (!(migration.oldName in overrides)) continue;

    if (migration.newName === null) {
      // Pass removed — delete from overrides.
      delete overrides[migration.oldName];
      removedPasses.push(migration.oldName);
    } else if (migration.newName in overrides) {
      // Target already has an override — drop the legacy key without clobbering.
      delete overrides[migration.oldName];
      renamedPasses.push({ oldName: migration.oldName, newName: migration.newName });
    } else {
      // Pass renamed — move override entry to new key.
      overrides[migration.newName] = overrides[migration.oldName];
      delete overrides[migration.oldName];
      renamedPasses.push({ oldName: migration.oldName, newName: migration.newName });
    }
  }

  // 2. Apply parameter migrations within override entries.
  for (const migration of tables.paramMigrations) {
    const passOverride = overrides[migration.passType];
    if (!passOverride || !(migration.oldParam in passOverride)) continue;

    const oldValue = passOverride[migration.oldParam];
    let newValue: unknown;

    if (migration.transformValue) {
      try {
        newValue = migration.transformValue(oldValue);
      } catch (err) {
        // Transform failed — discard the parameter.
        console.warn(
          `[passMigration] Failed to transform ${migration.passType}.${migration.oldParam}:`,
          err,
        );
        delete passOverride[migration.oldParam];
        discardedParams++;
        continue;
      }
    } else {
      newValue = oldValue;
    }

    passOverride[migration.newParam] = newValue;
    delete passOverride[migration.oldParam];
    migratedParams++;
  }

  // Build the migrated state.
  const migratedState: UIState = {
    ...state,
    passRecipeOverrides: Object.keys(overrides).length > 0 ? overrides as UIState["passRecipeOverrides"] : undefined,
  };

  return {
    state: migratedState,
    renamedPasses,
    removedPasses,
    migratedParams,
    discardedParams,
  };
}
