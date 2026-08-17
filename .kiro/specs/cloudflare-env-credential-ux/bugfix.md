# Bugfix Requirements Document

## Introduction

The Cloudflare Workers AI provider settings form displays misleading environment credential detection messages. When `CLOUDFLARE_API_TOKEN` is present but `CLOUDFLARE_ACCOUNT_ID` is missing or invalid, the API Key field incorrectly shows a green "Env available" badge suggesting env-only activation works. Additionally, the Account ID field never shows any env detection hint — even when both env vars are valid — causing users to paste values unnecessarily and trigger the partial-paste validation guard with a confusing error.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `CLOUDFLARE_API_TOKEN` is set in env but `CLOUDFLARE_ACCOUNT_ID` is missing or invalid (envPresentOnly=true for the combined credential) THEN the system shows the green "Env available: CLOUDFLARE_API_TOKEN" badge on the API Key field despite env-only activation being impossible (the `envUsable` flag is driven by the token env var name match via `matchedEnvApiKeyName`, which reports `present=true` and `envVar=CLOUDFLARE_API_TOKEN` even when the composite credential is not usable)

1.2 WHEN both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are valid in env (envUsable=true) THEN the Account ID field shows only the generic placeholder "32-char hex CLOUDFLARE_ACCOUNT_ID" with no env detection badge or "Leave blank" hint, giving no indication that the value is already available from env

1.3 WHEN the user pastes only the Account ID (because the API Key field said "Leave blank") and clicks Save THEN the system shows the error "Enter a Cloudflare API token, or clear the account ID to use env credentials" — contradicting the green badge hint that env credentials were sufficient

1.4 WHEN `envPresentOnly` is true (token present, account ID missing/invalid) THEN the amber "Found CLOUDFLARE_API_TOKEN (incomplete)" badge appears on the API Key field with no explanation of WHY it's incomplete or what action the user should take

### Expected Behavior (Correct)

2.1 WHEN both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are valid in env (envUsable=true) THEN the system SHALL show the green "Env available" badge and "Leave blank to use..." placeholder on BOTH the API Key field AND the Account ID field

2.2 WHEN `CLOUDFLARE_API_TOKEN` is set but `CLOUDFLARE_ACCOUNT_ID` is missing or invalid (envPresentOnly) THEN the system SHALL show the amber "incomplete" badge on the API Key field with a helper message explaining that `CLOUDFLARE_ACCOUNT_ID` is missing or invalid and both fields must be filled manually

2.3 WHEN `CLOUDFLARE_ACCOUNT_ID` is present and valid in env but `CLOUDFLARE_API_TOKEN` is missing (partial env state, inverse of 2.2) THEN the Account ID field SHALL show an env detection badge indicating it's available from env, while the API Key field clearly indicates it must be provided manually

2.4 WHEN the env credential status reports `envUsable=true` for cloudflare THEN the API Key field green badge and the Account ID field green badge SHALL both accurately reflect that env-only activation will succeed without any manual input

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user manually enters both an API token and Account ID (regardless of env var state) THEN the system SHALL CONTINUE TO accept and activate with those manually-provided values

3.2 WHEN a non-Cloudflare provider is selected (e.g., openai, anthropic, gemini) THEN the system SHALL CONTINUE TO display env credential badges using the existing single-field logic unchanged

3.3 WHEN no Cloudflare env vars are set at all THEN the system SHALL CONTINUE TO show no env detection badges and require both fields to be filled manually

3.4 WHEN the user clears both manual fields and env credentials are fully usable THEN the system SHALL CONTINUE TO allow env-only activation via the Save button without error

3.5 WHEN the partial-paste validation guard fires (one field filled, one empty, env not usable) THEN the system SHALL CONTINUE TO show an actionable error message preventing incomplete configuration from being saved
