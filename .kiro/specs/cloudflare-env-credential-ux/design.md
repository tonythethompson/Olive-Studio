# Design Document: Cloudflare Env Credential UX Fix

## Overview

The Cloudflare Workers AI provider form uses a single `EnvCredentialStatus` record for badge display, but Cloudflare requires two env vars (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) to function. The current UI only shows env detection on the API Key field, leaving the Account ID field blind to its env status. When only one var is present, the badges mislead users into partial configurations that hit validation errors.

The fix extends the server response with Cloudflare-specific account ID status, and updates the Account ID field in the form to display its own env detection badge. The API Key field's "incomplete" badge gets a helper explaining what's missing.

## Architecture

### Data Flow

```
Server (providerRoutes.ts)
  envCredentialsPayload()
    → reads CLOUDFLARE_API_TOKEN (via readEnvApiKey)
    → reads CLOUDFLARE_ACCOUNT_ID (via process.env)
    → validates account ID (isValidCloudflareAccountId)
    → produces: { cloudflare: { present, envVar, usable, cloudflareAccountId: { present, valid } } }
  → GET /api/ai/provider response

Client (ManualProviderSetup.tsx)
  providerEnvCredential(envCredentials, "cloudflare")
    → envCred.usable = both vars valid → green badges on BOTH fields
    → envCred.present && !envCred.usable → amber badge on API Key + helper text
    → envCred.cloudflareAccountId.present && envCred.cloudflareAccountId.valid → green badge on Account ID
    → envCred.cloudflareAccountId.present && !envCred.cloudflareAccountId.valid → amber badge on Account ID
```

### Type Changes

```typescript
// src/lib/envCredentialUi.ts

export type EnvCredentialStatus = {
  present: boolean;
  envVar: string | null;
  usable: boolean;
  /** Cloudflare-only: status of the CLOUDFLARE_ACCOUNT_ID env var. */
  cloudflareAccountId?: {
    present: boolean;
    valid: boolean;
  };
};
```

This is backward-compatible: non-Cloudflare providers simply omit the field (it's optional).

## Components and Interfaces

### Modified Components

| File                                                        | Role                                                       | Interface                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/lib/envCredentialUi.ts`                                | Shared type definitions consumed by both server and client | Exports `EnvCredentialStatus` type; `providerEnvCredential(envCredentials, providerName)` accessor   |
| `src/server/services/ai/registry.ts`                        | Provider registry and env credential assembly              | `listEnvCredentialStatus(extraUsable?, extraFields?)` — builds the per-provider status map           |
| `src/server/routes/ai/providerRoutes.ts`                    | Express route handler for `GET /api/ai/provider`           | `envCredentialsPayload()` (private) — reads env vars, validates, and produces the response payload   |
| `src/components/features/assistant/ManualProviderSetup.tsx` | React form for manual provider configuration               | `ApiKeyForm` component — renders API Key and Account ID fields with conditional env detection badges |

### Interface Contracts

**`listEnvCredentialStatus(extraUsable?, extraFields?)`**

```typescript
function listEnvCredentialStatus(
  extraUsable?: Partial<Record<ProviderConfig["provider"], boolean>>,
  extraFields?: Partial<Record<ProviderConfig["provider"], Omit<EnvCredentialStatus, "present" | "envVar" | "usable">>>,
): Record<string, EnvCredentialStatus>;
```

- `extraUsable` overrides the default `usable` derivation (existing behavior, unchanged).
- `extraFields` merges provider-specific sub-fields (new parameter). Only Cloudflare uses this today.

**`envCredentialsPayload()`**

Returns the full `Record<string, EnvCredentialStatus>` for all registered providers. For Cloudflare, the record includes the `cloudflareAccountId` sub-object.

**`ApiKeyForm` component props** (unchanged externally)

The component reads `envCredentials` from the parent query response and derives badge state internally. No prop changes needed.

## Data Models

### EnvCredentialStatus (extended)

```typescript
export type EnvCredentialStatus = {
  /** Whether the primary env var (e.g., CLOUDFLARE_API_TOKEN) is present. */
  present: boolean;
  /** The matched env var name, or null if not found. */
  envVar: string | null;
  /** Whether env-only activation is possible (all required vars valid). */
  usable: boolean;
  /** Cloudflare-only: independent status of CLOUDFLARE_ACCOUNT_ID env var. */
  cloudflareAccountId?: {
    /** Whether the env var is set (non-empty). */
    present: boolean;
    /** Whether the value passes isValidCloudflareAccountId (32-char hex). */
    valid: boolean;
  };
};
```

### JSON Response Shape

`GET /api/ai/provider` response body (partial):

```jsonc
{
  "envCredentials": {
    "openai": { "present": true, "envVar": "OPENAI_API_KEY", "usable": true },
    "cloudflare": {
      "present": true,
      "envVar": "CLOUDFLARE_API_TOKEN",
      "usable": true,
      "cloudflareAccountId": {
        "present": true,
        "valid": true
      }
    }
    // ... other providers without cloudflareAccountId
  }
}
```

Non-Cloudflare providers never include `cloudflareAccountId`. The field is optional at the type level and omitted from serialization when not explicitly provided via `extraFields`.

## Detailed Design

### 1. Server: Extend envCredentialsPayload()

**File:** `src/server/routes/ai/providerRoutes.ts`

**Current:**
```typescript
function envCredentialsPayload() {
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const cfAuth = resolveCloudflareAuth();
  const cloudflareUsable =
    Boolean(cfAuth) ||
    (Boolean(readEnvApiKey("CLOUDFLARE_API_TOKEN")) && isValidCloudflareAccountId(cfAccount));
  return listEnvCredentialStatus({ cloudflare: cloudflareUsable });
}
```

**After:**
```typescript
function envCredentialsPayload() {
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const cfAuth = resolveCloudflareAuth();
  const cloudflareUsable =
    Boolean(cfAuth) ||
    (Boolean(readEnvApiKey("CLOUDFLARE_API_TOKEN")) && isValidCloudflareAccountId(cfAccount));

  const cfAccountIdPresent = cfAccount.length > 0 || Boolean(cfAuth?.accountId);
  const cfAccountIdValid =
    isValidCloudflareAccountId(cfAccount) || Boolean(cfAuth?.accountId);

  return listEnvCredentialStatus(
    { cloudflare: cloudflareUsable },
    { cloudflare: { cloudflareAccountId: { present: cfAccountIdPresent, valid: cfAccountIdValid } } },
  );
}
```

**File:** `src/server/services/ai/registry.ts`

Add a second optional parameter to `listEnvCredentialStatus` for provider-specific extra fields:

```typescript
export function listEnvCredentialStatus(
  extraUsable?: Partial<Record<ProviderConfig["provider"], boolean>>,
  extraFields?: Partial<Record<ProviderConfig["provider"], Omit<EnvCredentialStatus, "present" | "envVar" | "usable">>>,
): Record<string, EnvCredentialStatus> {
  const out: Record<string, EnvCredentialStatus> = {};
  for (const plugin of providers.values()) {
    const envVar = matchedEnvApiKeyName(...plugin.envVarNames) ?? null;
    const present = Boolean(envVar);
    const usable = extraUsable?.[plugin.name] ?? present;
    out[plugin.name] = { present, envVar, usable, ...extraFields?.[plugin.name] };
  }
  return out;
}
```

### 2. Types: EnvCredentialStatus extension

**File:** `src/lib/envCredentialUi.ts`

Add the optional `cloudflareAccountId` field to the existing type:

```typescript
export type EnvCredentialStatus = {
  present: boolean;
  envVar: string | null;
  usable: boolean;
  /** Cloudflare-only: independent status of CLOUDFLARE_ACCOUNT_ID env var. */
  cloudflareAccountId?: {
    present: boolean;
    valid: boolean;
  };
};
```

No other changes to this file. The `providerEnvCredential()` function returns the full record, so clients can access `envCred?.cloudflareAccountId` directly.

### 3. Client: Account ID field env detection

**File:** `src/components/features/assistant/ManualProviderSetup.tsx`

In the `ApiKeyForm` component, add env detection UI to the Cloudflare Account ID field:

**Current Account ID block (around line 278):**
```tsx
{settingsProvider === "cloudflare" && (
  <div>
    <label className="text-sm text-slate-400 mb-1 block" htmlFor="gemini-cf-account-id">
      Cloudflare Account ID
    </label>
    <input ... placeholder="32-char hex CLOUDFLARE_ACCOUNT_ID" ... />
    <p className="text-[11px] text-slate-600 mt-1">
      Required with the API token. Workers AI is account-scoped.
    </p>
  </div>
)}
```

**After:**
```tsx
{settingsProvider === "cloudflare" && (
  <div>
    <label
      className="text-sm text-slate-400 mb-1 flex flex-wrap items-center gap-1.5"
      htmlFor="gemini-cf-account-id"
    >
      Cloudflare Account ID
      {envUsable && !settingsCloudflareAccountId.trim() ? (
        <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-semibold">
          Env available: CLOUDFLARE_ACCOUNT_ID
        </span>
      ) : envCred?.cloudflareAccountId?.present && !envCred.cloudflareAccountId.valid ? (
        <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono font-semibold">
          Found CLOUDFLARE_ACCOUNT_ID (invalid format)
        </span>
      ) : envCred?.cloudflareAccountId?.present && envCred.cloudflareAccountId.valid && !envUsable ? (
        <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-semibold">
          Env available: CLOUDFLARE_ACCOUNT_ID
        </span>
      ) : null}
    </label>
    <input
      ...
      placeholder={
        envUsable
          ? "Leave blank to use CLOUDFLARE_ACCOUNT_ID"
          : "32-char hex CLOUDFLARE_ACCOUNT_ID"
      }
      ...
    />
    <p className="text-[11px] text-slate-600 mt-1">
      Required with the API token. Workers AI is account-scoped.
    </p>
  </div>
)}
```

Badge logic summary for Account ID field:
| Condition                                                                | Badge                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `envUsable && !settingsCloudflareAccountId.trim()`                       | Green "Env available: CLOUDFLARE_ACCOUNT_ID"                                      |
| `cloudflareAccountId.present && !cloudflareAccountId.valid`              | Amber "Found CLOUDFLARE_ACCOUNT_ID (invalid format)"                              |
| `cloudflareAccountId.present && cloudflareAccountId.valid && !envUsable` | Green "Env available: CLOUDFLARE_ACCOUNT_ID" (token missing, but acct ID is fine) |
| Otherwise                                                                | No badge                                                                          |

### 4. Client: Improved incomplete-credential messaging

**File:** `src/components/features/assistant/ManualProviderSetup.tsx`

Replace the amber badge on the API Key field with more context when `envPresentOnly`:

**Current:**
```tsx
envPresentOnly ? (
  <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono font-semibold">
    Found {envCred!.envVar} (incomplete)
  </span>
) : ...
```

**After:**
```tsx
envPresentOnly ? (
  <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono font-semibold">
    Found {envCred!.envVar} (incomplete — {
      settingsProvider === "cloudflare" && !envCred?.cloudflareAccountId?.valid
        ? "CLOUDFLARE_ACCOUNT_ID missing or invalid"
        : "additional credentials needed"
    })
  </span>
) : ...
```

This addresses requirement 2.2 by explaining WHY the credential is incomplete specifically for Cloudflare.

### 5. Validation: No changes required

The existing `validateApiKeyProviderForm()` in `useAiProviderSettings.ts` already correctly handles:

- `envUsable && partial paste → error` (requirement 3.5)
- `!envUsable && both fields empty → error` (requirement 3.3)
- `envUsable && both fields empty → allowed` (requirement 3.4)
- `manual values in both fields → allowed` (requirement 3.1)

The validation logic does not need modification. The bug was purely a UI communication issue: users saw misleading badges that encouraged them into states the validation correctly rejected. By fixing the badge display, users will no longer be misled into those states.

## Correctness Properties

### Property 1: Green badge only when env-only activation succeeds

A green "Env available" badge is displayed on a field only when `envUsable === true` for the Cloudflare provider (meaning both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are valid). No field ever shows a green badge when env-only activation would fail.

### Property 2: Amber badge only when env var exists but cannot enable env-only activation alone

The amber "incomplete" or "invalid format" badge appears only when the env var for that field is present but the composite credential is not usable. The amber badge is never shown when `envUsable` is true.

### Property 3: Account ID badge is independent from API Key badge

Each field reflects the status of its own env var. The Account ID field can show a green badge (indicating `CLOUDFLARE_ACCOUNT_ID` is present and valid) even when the API Key field shows no badge (because `CLOUDFLARE_API_TOKEN` is absent). The two badges are derived from distinct data paths.

### Property 4: Non-Cloudflare providers never see cloudflareAccountId in their status

The `cloudflareAccountId` sub-field is only present in the response for the `"cloudflare"` provider key. All other providers return only `{ present, envVar, usable }`. This ensures backward compatibility with any client logic that iterates over env credential records.

### Property 5: Placeholder text matches badge state

The Account ID input placeholder reads "Leave blank to use CLOUDFLARE_ACCOUNT_ID" only when `envUsable` is true (green badge shown). In all other states the placeholder reads "32-char hex CLOUDFLARE_ACCOUNT_ID". The placeholder and badge are never contradictory.

## Error Handling

### Edge Cases

| Scenario                                                                                                                        | Behavior                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` is set but not valid 32-char hex                                                                        | Server reports `cloudflareAccountId: { present: true, valid: false }`. Client displays an amber badge "Found CLOUDFLARE_ACCOUNT_ID (invalid format)". No crash or exception.                                                  |
| Server returns `envCredentials` without `cloudflareAccountId` field (e.g., older server version, or provider is not Cloudflare) | Client accesses `envCred?.cloudflareAccountId` via optional chaining. Returns `undefined`, badge rendering branch evaluates to `null`. No badge shown — graceful degradation.                                                 |
| Both Cloudflare env vars are absent                                                                                             | Server reports `{ present: false, envVar: null, usable: false, cloudflareAccountId: { present: false, valid: false } }`. No badge conditions match. Form renders as a clean manual-entry experience with no env detection UI. |
| `resolveCloudflareAuth()` returns a Wrangler auth object with `accountId`                                                       | `cfAccountIdPresent` and `cfAccountIdValid` both become `true` via the `Boolean(cfAuth?.accountId)` fallback path. Badges display correctly without relying on the raw env var.                                               |
| `CLOUDFLARE_ACCOUNT_ID` is set to whitespace only                                                                               | `process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ""` normalizes to empty string. Server treats as not present (`cfAccount.length > 0` is false). No false-positive badge.                                                        |

### Defensive Patterns

- All client-side access to `cloudflareAccountId` uses optional chaining (`?.`) to guard against missing fields.
- The `extraFields` spread in `listEnvCredentialStatus` only adds fields when explicitly provided — no accidental property pollution.
- Badge rendering uses explicit ternary chains terminating in `null`, so no unexpected DOM elements appear for unhandled states.

## Testing Strategy

### Unit Tests

**File:** `src/lib/__tests__/envCredentialUi.test.ts` (or existing `src/lib/envCredentialUi.test.ts`)

1. `providerEnvCredential` returns `cloudflareAccountId` sub-field when present
2. `canActivateWithEnvKey` remains unchanged for cloudflare (still checks `usable`)
3. Type compatibility: non-Cloudflare providers work without `cloudflareAccountId`

**File:** `src/server/__tests__/envCredentialsPayload.test.ts` (new or extend existing server tests)

1. Both env vars set and valid → `usable: true`, `cloudflareAccountId: { present: true, valid: true }`
2. Token set, account ID missing → `usable: false`, `present: true`, `cloudflareAccountId: { present: false, valid: false }`
3. Token set, account ID present but invalid (not 32 hex) → `usable: false`, `present: true`, `cloudflareAccountId: { present: true, valid: false }`
4. Neither env var set → `usable: false`, `present: false`, `cloudflareAccountId: { present: false, valid: false }`
5. `resolveCloudflareAuth()` returns auth object (Wrangler flow) → `usable: true`, `cloudflareAccountId: { present: true, valid: true }`

**File:** `src/components/features/assistant/__tests__/ManualProviderSetup.test.tsx` (component test, if exists)

1. Cloudflare + `envUsable` true → both fields show green badge, both placeholders say "Leave blank..."
2. Cloudflare + `envPresentOnly` → API Key shows amber with "CLOUDFLARE_ACCOUNT_ID missing or invalid"
3. Cloudflare + account ID present/invalid → Account ID shows amber with "invalid format"
4. Non-Cloudflare provider → no `cloudflareAccountId` badge logic rendered

### Property-Based Tests

**Framework:** Vitest + fast-check

A property test for `listEnvCredentialStatus` verifying:
- For any combination of `extraUsable` and `extraFields` values, the output always includes `present`, `envVar`, and `usable` for every registered provider
- The `cloudflareAccountId` field is only present when explicitly passed via `extraFields`

## Traceability

| Design Section                            | Bugfix Requirement                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1. Server: Extend envCredentialsPayload() | Enables 2.1, 2.2, 2.3 — provides per-field env status data                                   |
| 2. Types: EnvCredentialStatus extension   | Enables 2.1, 2.2, 2.3 — type-safe client access to account ID status                         |
| 3. Client: Account ID field env detection | 2.1 (green badge on Account ID when fully usable), 2.3 (Account ID badge when token missing) |
| 4. Client: Improved incomplete messaging  | 2.2 (amber badge explains CLOUDFLARE_ACCOUNT_ID missing/invalid)                             |
| 5. Validation: No changes                 | 3.1, 3.2, 3.3, 3.4, 3.5 (all unchanged behaviors preserved)                                  |

| Regression Requirement                  | Guarantee                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 3.1 Manual override still works         | Validation unchanged; badges only show when fields are empty                                                  |
| 3.2 Non-Cloudflare providers unaffected | `cloudflareAccountId` field is optional; only rendered for `settingsProvider === "cloudflare"`                |
| 3.3 No env vars → no badges             | Both `present` and `usable` false → no badge branches match                                                   |
| 3.4 Env-only activation still works     | Green badge + "Leave blank" placeholder guide user correctly; validation allows empty fields when `envUsable` |
| 3.5 Partial-paste guard preserved       | Validation code untouched; same error messages fire                                                           |
