# Implementation Plan: Cloudflare Env Credential UX Fix

## Overview

The Cloudflare Workers AI provider requires two env vars (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) but the UI only reports env detection on the API Key field. This fix extends the server response with per-field status, updates the Account ID field to show its own env badge, and improves the "incomplete" messaging on the API Key field so users understand exactly what's missing.

## Tasks

- [x] 1. Extend EnvCredentialStatus type
  - [x] 1.1 Add optional `cloudflareAccountId` field to `EnvCredentialStatus` in `src/lib/envCredentialUi.ts`
    - Add `cloudflareAccountId?: { present: boolean; valid: boolean }` to the existing type
    - This is backward-compatible: non-Cloudflare providers simply omit the field
    - No other changes to this file; `providerEnvCredential()` already returns the full record so clients access `envCred?.cloudflareAccountId` via optional chaining
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 2. Update listEnvCredentialStatus in registry.ts
  - [x] 2.1 Add `extraFields` parameter to `listEnvCredentialStatus()` in `src/server/services/ai/registry.ts`
    - Add a second optional parameter: `extraFields?: Partial<Record<ProviderConfig["provider"], Omit<EnvCredentialStatus, "present" | "envVar" | "usable">>>`
    - In the loop body, spread extra fields onto the per-provider record: `out[plugin.name] = { present, envVar, usable, ...extraFields?.[plugin.name] }`
    - Import the updated `EnvCredentialStatus` type (already imported from `@/lib/envCredentialUi`)
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Update envCredentialsPayload in providerRoutes.ts
  - [x] 3.1 Compute Cloudflare Account ID presence and validity in `envCredentialsPayload()` in `src/server/routes/ai/providerRoutes.ts`
    - After the existing `cloudflareUsable` computation, add:
      - `const cfAccountIdPresent = cfAccount.length > 0 || Boolean(cfAuth?.accountId)`
      - `const cfAccountIdValid = isValidCloudflareAccountId(cfAccount) || Boolean(cfAuth?.accountId)`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 3.2 Pass `extraFields` to `listEnvCredentialStatus()`
    - Change call from `listEnvCredentialStatus({ cloudflare: cloudflareUsable })` to `listEnvCredentialStatus({ cloudflare: cloudflareUsable }, { cloudflare: { cloudflareAccountId: { present: cfAccountIdPresent, valid: cfAccountIdValid } } })`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. Add env detection UI to Account ID field
  - [x] 4.1 Add badge logic to the Cloudflare Account ID `<label>` in `src/components/features/assistant/ManualProviderSetup.tsx`
    - Change `<label className="text-sm text-slate-400 mb-1 block" ...>` to use `flex flex-wrap items-center gap-1.5` layout (matching the API Key label pattern)
    - Add conditional badge rendering after the label text:
      - `envUsable && !settingsCloudflareAccountId.trim()` → green badge: "Env available: CLOUDFLARE_ACCOUNT_ID"
      - `envCred?.cloudflareAccountId?.present && !envCred.cloudflareAccountId.valid` → amber badge: "Found CLOUDFLARE_ACCOUNT_ID (invalid format)"
      - `envCred?.cloudflareAccountId?.present && envCred.cloudflareAccountId.valid && !envUsable` → green badge: "Env available: CLOUDFLARE_ACCOUNT_ID" (token missing, but acct ID is fine)
      - Otherwise → no badge (`null`)
    - _Requirements: 2.1, 2.3, 2.4_
  - [x] 4.2 Make the Account ID placeholder dynamic based on `envUsable`
    - When `envUsable` is true: `"Leave blank to use CLOUDFLARE_ACCOUNT_ID"`
    - Otherwise: `"32-char hex CLOUDFLARE_ACCOUNT_ID"` (existing behavior)
    - _Requirements: 2.1, 2.4_

- [x] 5. Improve incomplete-credential amber badge messaging
  - [x] 5.1 Update the `envPresentOnly` amber badge on the API Key field in `src/components/features/assistant/ManualProviderSetup.tsx`
    - Change from: `Found {envCred!.envVar} (incomplete)`
    - To: `Found {envCred!.envVar} (incomplete — {settingsProvider === "cloudflare" && !envCred?.cloudflareAccountId?.valid ? "CLOUDFLARE_ACCOUNT_ID missing or invalid" : "additional credentials needed"})`
    - This explains WHY the credential is incomplete specifically for Cloudflare
    - _Requirements: 2.2_

- [x] 6. Write server unit test for envCredentialsPayload
  - [x] 6.1 Create or extend test file for `envCredentialsPayload` env var combinations
    - Test file: `src/server/__tests__/envCredentialsPayload.test.ts` (or extend existing server route test)
    - Test cases:
      - Both env vars set and valid → `usable: true`, `cloudflareAccountId: { present: true, valid: true }`
      - Token set, account ID missing → `usable: false`, `present: true`, `cloudflareAccountId: { present: false, valid: false }`
      - Token set, account ID present but invalid (not 32 hex) → `usable: false`, `present: true`, `cloudflareAccountId: { present: true, valid: false }`
      - Neither env var set → `usable: false`, `present: false`, `cloudflareAccountId: { present: false, valid: false }`
      - `resolveCloudflareAuth()` returns auth object (Wrangler flow) → `usable: true`, `cloudflareAccountId: { present: true, valid: true }`
      - `CLOUDFLARE_ACCOUNT_ID` is whitespace only → treated as not present
      - Non-Cloudflare providers do not include `cloudflareAccountId` field
    - Run with: `pnpm vitest run --config vitest.server.config.ts <test-file>`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.3_

- [x] 7. Write component test for Cloudflare badge rendering
  - [x] 7.1 Create or extend component test for Account ID and API Key badge logic
    - Test file: `src/components/features/assistant/__tests__/ManualProviderSetup.test.tsx` (or similar)
    - Test cases:
      - Cloudflare + `envUsable: true` + empty fields → both fields show green badge, Account ID placeholder says "Leave blank..."
      - Cloudflare + `envPresentOnly` (token only) → API Key shows amber with "CLOUDFLARE_ACCOUNT_ID missing or invalid"
      - Cloudflare + account ID present but invalid → Account ID shows amber "invalid format" badge
      - Cloudflare + account ID present and valid but no token → Account ID shows green badge, API Key has no green badge
      - Non-Cloudflare provider → no `cloudflareAccountId` badge rendered
      - No env vars at all → no badges on either field
    - Run with: `pnpm vitest run --config vitest.component.config.ts <test-file>`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.2, 3.3_
