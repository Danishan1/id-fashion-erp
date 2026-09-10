# AI Provider & API Management + Automatic Failover

Built 2026-09-10 on top of AI Designer's existing image-generation pipeline. This document explains the
architecture, how to configure it, and its current limitations. See `CLAUDE.md`'s own dated section for the
narrative build log and live-verification notes.

## Why this exists

AI Designer's `generateDesign()`/`editDesign()` previously called one hardcoded provider, selected by a
single `IMAGE_GENERATION_PROVIDER` environment variable, with no fallback if that provider was down or out
of credits. This system replaces that with:

- An admin-configurable list of providers per company, each with a priority and a declared set of
  capabilities.
- Automatic failover to the next eligible provider on a transient failure (rate limit, quota exhausted,
  timeout, temporary outage) — but never on a real operational problem (bad credentials, a malformed
  request, a content-policy rejection), which surfaces immediately instead of being silently retried
  elsewhere.
- Real usage and failover audit trails.
- A "Test Connection" action per provider that performs a genuine, free/cheap connectivity check.

## Architecture

```
AI Designer (generateDesign / editDesign)
        |
        v
AIProviderManager.runWithFailover({ capability, call, ... })
        |
        v
AIProviderRepository.findCandidates(companyId, capability)
   -> active, declares the capability, not in a health-excluded state
   -> sorted by priority (lower tried first), then createdAt
        |
        v
for each candidate:
   buildProviderInstance(row)   -- decrypts the stored key, constructs the
                                    SAME ImageGenerationProvider objects
                                    src/core/ai/image-generation/factory.ts
                                    already builds from env vars, just from
                                    a database row instead
        |
   params.call(providerInstance) -- the caller (AI Designer) invokes
                                     whichever single method it actually
                                     needs (generate / generateVariation /
                                     applyFabric / generateFromFabricReference
                                     / generateTechnicalFlat)
        |
   success -> record AIProviderUsage, mark provider HEALTHY, return
   failure -> classify the error, record AIProviderUsage, apply a health
              penalty/cooldown, and either:
                - the error is failover-eligible AND a next candidate
                  exists AND this provider's autoFailoverEnabled is true
                  -> try the next candidate, log an AIFailoverLog row once
                     the outcome of that attempt is known
                - otherwise -> stop the whole chain, throw a clear error
```

**Deliberately reuses, not duplicates, the existing provider abstraction.** `AIProviderManager` never
reimplements any provider's own HTTP/SDK call logic — it constructs the exact same `ImageGenerationProvider`
objects `src/core/ai/image-generation/factory.ts` already builds from environment variables
(`createOpenAiImageProvider`/`createGeminiImageProvider`/`createCloudflareImageProvider`/
`createQwenLocalImageProvider`), just parameterized from a decrypted database row instead of `process.env`.
The env-var-driven `getImageGenerationProvider()` factory function itself is untouched and still works
exactly as before for any code that intentionally wants "whatever this deployment's one configured default
provider is" with no failover.

## Files

| Layer | File | Purpose |
|---|---|---|
| Schema | `prisma/schema.prisma` | `AIProvider`, `AIProviderUsage`, `AIFailoverLog` models; `AIProviderType`, `AIProviderCapability`, `AIProviderHealthStatus`, `AIUsageErrorCategory` enums |
| Error classification | `src/core/ai/provider-manager/error-classification.ts` | Maps the existing `ImageGenErrorCategory` taxonomy onto the failover-relevant `AIUsageErrorCategory`; defines which categories are failover-eligible |
| Repository | `src/core/ai/provider-manager/ai-provider.repository.ts` | The one Prisma-query surface for the 3 new tables, shared by the runtime engine and the admin service |
| Runtime engine | `src/core/ai/provider-manager/AIProviderManager.ts` | `runWithFailover()` — candidate selection, provider construction, failover loop, usage/health/failover logging |
| Connection test | `src/core/ai/provider-manager/connection-test.ts` | Orchestrates the real, free/cheap "Test Connection" check per provider type |
| Provider files (extended) | `src/core/ai/image-generation/providers/{openai,gemini,cloudflare,qwen-local}.ts` | Each factory function now takes an optional config override (backward compatible); each gained a real `testXConnection()` export and, for `openai`/`gemini`, a `generateFromFabricReference` method |
| New provider | `src/core/ai/image-generation/providers/qwen-local.ts` | A 4th, self-hosted provider — see its own section below |
| Admin schema | `src/modules/ai-providers/ai-provider.schema.ts` | Zod validation for create/update |
| Admin service | `src/modules/ai-providers/ai-provider-admin.service.ts` | CRUD, API-key masking, encryption, usage dashboard, failover log queries |
| API routes | `src/app/api/v1/administration/ai-providers/**` | REST endpoints, gated on the existing `administration` RBAC module |
| Admin UI | `src/app/(dashboard)/admin/AdminAiProvidersPanel.tsx` | New "AI Configuration" tab in the existing Administration page |
| AI Designer wiring | `src/modules/ai-designer/ai-designer.service.ts` | `generateDesign()`/`editDesign()` now call `runWithFailover()` instead of a single hardcoded provider |

## Admin configuration

**Settings → Administration → AI Configuration** (a new tab alongside Users/Branches/Roles/Company
Settings/etc. — deliberately reuses the existing `administration` RBAC module rather than inventing a new
one, matching every other admin-only settings tab in this app, none of which got a dedicated RBAC module
either).

Per provider: Name, Provider Type (OpenAI/Gemini/Cloudflare/Qwen Local), API Key/Credential, Model, Base URL
(where applicable — see the Cloudflare note below), Active/Inactive, Priority (lower = tried first), Auto
Failover Enabled, Daily/Monthly Generation Limit, Request Timeout, Max Retry Count, and Capabilities
(TEXT_TO_IMAGE / IMAGE_EDIT / FABRIC_REFERENCE).

Only `SUPER_ADMIN` can create/edit/delete providers (matching the existing `administration` module's
per-role grants — `MANAGEMENT`/`ACCOUNTS_MANAGER` get view-only, every other role gets none). Every
provider row is scoped to one company; there is no cross-company/global default tier in this version (see
Limitations).

### Cloudflare's Account ID

Cloudflare Workers AI needs two credential parts (an Account ID and an API Token), but the admin form has
only one generic "Base URL" field for this kind of extra connection metadata (the field list in the original
requirement had no dedicated "Account ID" slot). Rather than add a column no other provider type would ever
use, Cloudflare's Account ID is stored in the `baseUrl` column — the admin UI dynamically relabels that
field to "Cloudflare Account ID" whenever Provider Type = Cloudflare. This is documented directly in
`AIProviderManager.buildProviderInstance()`'s own comment.

## API key security

- **At rest**: encrypted with AES-256-GCM via the existing `src/core/security/encryption.ts`
  (`encryptSecret`/`decryptSecret`) — the same utility and the same `NEXTAUTH_SECRET`-derived key
  `AdAccountConnection`'s OAuth tokens already use. No new encryption key to configure or accidentally leave
  unset.
- **In API responses**: the raw `apiKeyEncrypted` column is stripped from every response. The frontend only
  ever receives `hasApiKey: boolean` and `apiKeyMasked: string | null` (e.g. `"sk-r••••2345"`) — see
  `toPublicShape()` in `ai-provider-admin.service.ts`, the single enforcement point every route goes through.
- **On update**: the API Key field is a real 3-state value — omitted from the request means "keep the
  existing key unchanged" (the form never pre-fills it), an explicit empty string clears it (only meaningful
  for Qwen Local, which may be genuinely unauthenticated), and any other value replaces it.
- **In logs**: `AIProviderManager`'s own `logger.info` calls, and every `writeAuditLog` call in the admin
  service, deliberately never include the key or its ciphertext — confirmed by a dedicated test
  (`ai-provider-admin.service.test.ts`, "the audit log never records the API key").

## Provider priority and capability-based selection

Priority is a plain integer per provider (lower tried first), but it is **never applied globally** — every
selection is first filtered to providers that declare the specific capability the request actually needs
(`TEXT_TO_IMAGE` / `IMAGE_EDIT` / `FABRIC_REFERENCE`), and only THEN sorted by priority. A provider with a
lower priority number that does not declare the needed capability is never a candidate at all, regardless of
its priority value.

**The concrete example from the requirement — Cloudflare must never be a fabric-reference fallback — holds
structurally, not just by convention**: Cloudflare's own provider file (`providers/cloudflare.ts`) simply
does not implement `generateFromFabricReference` (its REST API has no image-input field of any kind — see
the file's own header comment). Even if an admin mistakenly ticks "FABRIC_REFERENCE" on a Cloudflare
provider row, `connection-test.ts`'s "Test Connection" action will report the mismatch
(`capabilitySupported: false`), and if it were ever selected as a candidate anyway, the `call` callback's own
runtime check (`if (!provider.generateFromFabricReference) throw ...UNSUPPORTED_OPERATION`) stops it — which
`AIProviderManager` classifies as `INTERNAL_ERROR` (a configuration mismatch), which is **not**
failover-eligible, so it fails loudly rather than being silently skipped.

## Automatic failover

Exact error-category-to-failover-eligibility mapping (`error-classification.ts`):

| Category | Failover-eligible? | Examples |
|---|---|---|
| `QUOTA_EXHAUSTED` | Yes | Credits exhausted, daily/monthly cap hit |
| `RATE_LIMITED` | Yes | HTTP 429 (not a quota exhaustion) |
| `PROVIDER_UNAVAILABLE` | Yes | 5xx, an unusable/empty response |
| `TIMEOUT` | Yes | The request took too long |
| `AUTH_ERROR` | **No** | Invalid/expired API key |
| `INVALID_REQUEST` | **No** | Malformed image, unsupported format, bad prompt |
| `CONTENT_POLICY` | **No** | The provider flagged the content |
| `INTERNAL_ERROR` | **No** | An application/configuration bug (e.g. a capability-declaration mismatch) |

**Why `AUTH_ERROR` does not fail over even though it is often provider-specific**: an invalid or expired API
key is a real operational problem an admin needs to see and fix. Silently switching to a different provider
would let a broken credential go unnoticed indefinitely. `INVALID_REQUEST`/`CONTENT_POLICY` are properties of
the request itself and would fail identically on any other provider. `INTERNAL_ERROR` means this
application's own code or configuration is broken, which retrying against a different external provider can
never fix.

A provider's own `autoFailoverEnabled` flag is checked too — even a failover-eligible error will not move to
the next candidate if the failing provider has that flag off.

## Quota handling / health state

Each provider row carries a runtime `healthStatus` (`HEALTHY` / `RATE_LIMITED` / `QUOTA_EXHAUSTED` /
`UNAVAILABLE` / `AUTH_ERROR` / `DISABLED`) and an optional `cooldownUntil` timestamp, distinct from the
static `isActive` admin toggle. After every real failure, a health penalty is applied:

| Category | Health status set to | Cooldown |
|---|---|---|
| `RATE_LIMITED` | `RATE_LIMITED` | 1 minute |
| `QUOTA_EXHAUSTED` | `QUOTA_EXHAUSTED` | 15 minutes |
| `PROVIDER_UNAVAILABLE` / `TIMEOUT` | `UNAVAILABLE` | 2 minutes |
| `AUTH_ERROR` | `AUTH_ERROR` | None — no timed auto-recovery, needs an admin to fix the credential or click Reset |
| `INVALID_REQUEST` / `CONTENT_POLICY` / `INTERNAL_ERROR` | unchanged | — these are properties of the request, not evidence the provider itself is unwell |

A provider in cooldown (or in `AUTH_ERROR`/`DISABLED`) is excluded from `findCandidates()` until its cooldown
expires (or, for `AUTH_ERROR`/`DISABLED`, until an admin manually intervenes via the "Reset" action). This is
what prevents hammering an exhausted/broken provider on every single request.

## Usage tracking

Every real generation attempt (success or failure) that reaches `AIProviderManager` writes an
`AIProviderUsage` row — provider, model (via the provider relation), user, AI Designer project, generation
type, timestamp, duration, success/failure, error category, whether an input image was present, and output
count. `providerId` is nullable specifically for the "no compatible provider was even found" case, so that
failure mode is still visible in the usage history.

**`providerBalance` is always `null`.** None of OpenAI, Gemini, Cloudflare Workers AI, or a self-hosted Qwen
server expose a "remaining credit balance" API this integration calls anywhere. The admin usage dashboard
shows real, locally-tracked counts ("Used today: 12 / 50") and explicitly states "Provider balance: Not
available" rather than fabricating or omitting the field.

`tokenUsage`/`estimatedCost`/`providerRequestId` columns exist in the schema for future use but are not
currently populated by any of the 4 provider integrations — none of their response parsing code currently
extracts this information. Populating them is a real, scoped future addition, not a broken feature.

## Fabric-reference behavior — never faked

If a generation request genuinely needs `FABRIC_REFERENCE` and no currently-configured, active provider
declares that capability, `AIProviderManager` returns a clear error (*"No configured AI provider currently
supports fabric-reference generation. Please configure OpenAI, Gemini, Qwen Image Edit, or another
compatible provider."*) rather than ever silently falling back to a text-only call. This is enforced at two
layers: `findCandidates()` only returns providers whose `capabilities` array includes `FABRIC_REFERENCE`,
and the `call` callback AI Designer passes in explicitly checks for `generateFromFabricReference` before
invoking it, throwing `UNSUPPORTED_OPERATION` (never failover-eligible) if a provider slips through without
actually supporting it.

## Qwen Image Edit / local AI provider

No specific existing local-serving tool's own API (ComfyUI, vLLM, text-generation-webui, a custom wrapper)
was assumed, since none was available in this environment to verify against. Instead,
`providers/qwen-local.ts` defines one small, explicit HTTP contract — "the Qwen Local Bridge" — that any
local server can implement:

```
POST {baseUrl}/v1/generate
Headers: Content-Type: application/json; Authorization: Bearer <apiKey> (only if configured)
Body: { model, prompt, count, images?: [{ data: base64, mimeType }] }  -- 0, 1, or 2 reference images
Response 200: { images: [{ data: base64, mimeType }] }
Response 4xx/5xx: { error: { message, retryable?: boolean } }

GET {baseUrl}/v1/health
Response 200: { status: "ok", model: string }
```

Configure via `QWEN_LOCAL_BASE_URL` (required), `QWEN_LOCAL_MODEL`, `QWEN_LOCAL_API_KEY` (optional) for the
env-var-driven default provider, or via the admin UI (Provider Type = Qwen Local) for a database-configured
one. **Honestly unverified against a real running server** — no local GPU/model server was available in this
environment. The HTTP client logic itself (timeout handling, JSON parsing, error mapping) is real and would
work against any server that actually speaks this contract; only "does a real Qwen deployment happen to speak
this exact contract out of the box" is unverified — a real deployment may need a thin adapter in front of it.

## How to add a new provider

1. Add the new value to the `AIProviderType` enum in `prisma/schema.prisma` and migrate.
2. Add a `getXConfig()` function to `src/core/ai/image-generation/config.ts`.
3. Create `src/core/ai/image-generation/providers/x.ts` implementing `ImageGenerationProvider` (only
   `generate` is required; add `generateVariation`/`applyFabric`/`generateFromFabricReference`/
   `generateTechnicalFlat` for whichever capabilities the new provider genuinely supports), plus a
   `testXConnection()` export for the admin "Test Connection" action.
4. Add one case to `factory.ts`'s switch (for env-var-driven default-provider support) and to
   `AIProviderManager.buildProviderInstance()`'s switch (for database-configured providers).
5. Add the new type to `PROVIDER_TYPE_VALUES` in `src/modules/ai-providers/ai-provider.schema.ts` and to the
   admin UI's provider-type `<select>`.

Nothing in `ai-designer.service.ts`, `AIProviderManager`'s failover loop, or any route/UI file needs to
change — they only ever talk to the `ImageGenerationProvider` interface and the database-driven candidate
list.

## Limitations

- **No global/cross-company default tier.** Every `AIProvider` row is scoped to exactly one company; there
  is no genuine "global config + per-company override" pattern anywhere else in this codebase to extend
  (`SubmoduleVisibility`'s own "global default" is a hardcoded `true` fallback in code, not a queryable
  global row), and inventing one for this feature alone was judged premature complexity without a proven
  need. A nullable `companyId` could be added later without breaking this shape.
- **`tokenUsage`/`estimatedCost`/`providerRequestId` are schema-ready but not yet populated** — none of the
  4 provider integrations currently extract this information from their responses.
- **Qwen Local's HTTP contract is unverified against a real server** — see its own section above.
- **Per-provider Daily/Monthly Generation Limit is enforced, per-user/per-company is not.** A pre-flight
  `withinGenerationLimits()` check in `runWithFailover()` (using the same `AIProviderUsageRepository
  .countSince()` the admin usage dashboard already reads from, and the same UTC-calendar-boundary helpers
  — `utcStartOfDay()`/`utcStartOfMonth()` — the dashboard uses, so both always agree on exactly the same
  "today"/"this month" window) excludes a provider whose real, locally-tracked usage has already reached its
  configured limit from the candidate list before it is ever attempted — the same treatment a
  health-cooldown provider gets. There is no separate per-user or per-company cap anywhere in this feature;
  every generation counts only against the provider's own limit.
- **Cooldown durations are fixed constants**, not admin-configurable — 1/15/2 minutes for
  rate-limit/quota/unavailable respectively. Reasonable defaults, not tuned per real-world provider behavior
  over time.
