# Devin subscription client (Olive Studio)

**Devin** is a multi-model subscription for Assistant audit/chat after the user
signs in (plan models are selected separately).

## Flow

1. Open browser sign-in URL (`/api/devin/login` → `authUrl`).
2. User signs in; page shows a token (`show-auth-token`).
3. User pastes token into Olive → RegisterUser → long-lived API key stored in
   `.olive-studio/devin-credentials.json`.
4. Chat uses cloud-direct Connect-RPC (`GetUserJwt` + `GetChatMessage` stream).

## Attribution

OAuth exchange and Connect-RPC wire format adapted (MIT) from:

- [pi-devin-auth](https://github.com/nmzpy/pi-devin-auth)
- [opencode-windsurf-auth](https://github.com/rsvedant/opencode-windsurf-auth)

Infrastructure hostnames may still reference historical product names; product
branding in Olive Studio is **Devin**.

## Scope

- Chat / audit only (no agent tools / file mutation in this integration)
- Experimental — private protocol; may break if Devin rotates endpoints
