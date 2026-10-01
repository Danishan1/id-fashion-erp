# CRM — External Integration Awareness

_Received 2026-10-01. Companion to `CRM_MASTER_BLUEPRINT.md`. This document does **not** mean integrations are built now — each phase builds only what it needs._

## Purpose

The CRM is part of a larger ERP system. During development, Claude Code must be aware that the CRM will eventually connect with multiple external platforms.

Do NOT implement all integrations at once. Whenever a development phase requires an external integration, use the integration architecture below and implement only the integration required for that phase.

## 1. Integration categories

**Lead sources:** Facebook Lead Ads / Meta · Instagram · IndiaMART · Google Lead Ads · LinkedIn Lead Gen Forms · Website / Landing Page Forms

**Communication:** WhatsApp Business API · Gmail / Google Workspace · Microsoft Outlook / Microsoft 365 · SMS providers · Email SMTP · Facebook Messenger · Instagram Messaging

**Calling:** Twilio · Exotel · Knowlarity · other compatible telephony providers

**Scheduling:** Google Calendar · Microsoft Calendar · Calendly

**Automation & connectivity:** REST API · Incoming Webhooks · Outgoing Webhooks · Zapier · Make · Pabbly

**Documents / storage:** Google Drive · OneDrive · Dropbox

**Internal ERP integration:** Customers · Quotations · Sales Orders · Invoices · Payments · Products · Inventory · Projects · Tickets / Support · Employees / Users

## 2. Integration architecture rule

Do not create separate, hard-coded integration logic inside individual CRM features. Use a reusable integration/provider architecture:

```
CRM Feature
    ↓
Integration Service / Adapter
    ↓
External Provider
```

Examples:

```
Lead Capture → Lead Integration Adapter → Facebook / IndiaMART / Google / LinkedIn
Conversation → Messaging Adapter → WhatsApp / Gmail / SMS / Messenger / Instagram
```

Additional providers must be addable later without rewriting the CRM feature itself.

## 3. Integration capabilities

When implementing an integration, consider only the capabilities required by that phase, but follow a consistent pattern:

- Authentication / OAuth / API credentials
- Connection status
- Provider configuration
- Field mapping
- Data synchronization
- Incoming webhooks
- Outgoing events/webhooks
- Error handling
- Retry handling
- Integration logs
- Disconnect / reconnect
- Token expiry / re-authentication

Do not build unnecessary integration capabilities until they are required.

## 4. CRM events

Design CRM features so they can eventually generate events such as:

```
lead.created
lead.updated
contact.created
opportunity.created
opportunity.stage_changed
task.created
task.completed
appointment.created
message.received
message.sent
form.submitted
```

These events may later trigger workflows or external integrations.

## 5. Implementation rules

1. Do not implement every integration immediately.
2. Do not create fake integrations or mock production behavior unless the current phase specifically requires a mock.
3. When a phase requires an integration, implement only the required provider/capability.
4. Reuse existing ERP authentication, users, customers and master data wherever possible.
5. Do not duplicate ERP transactional data unnecessarily.
6. Keep integration credentials secure; never expose secrets in frontend code or logs.
7. Follow existing project architecture and naming conventions before introducing new services/tables.
8. If the provider API is unavailable or requires credentials, build the correct interface/configuration and clearly report the dependency instead of inventing functionality.
9. Every integration must be replaceable/extensible through an adapter/provider approach.
10. Before implementing a new integration, check whether an existing integration service already exists in the codebase and reuse it.

## 6. Phase-based principle

Development stays sequential. For every phase ask: **"Does this feature require an external integration?"**

- **No** → continue without integration functionality.
- **Yes** → identify the required provider, use the architecture above, implement only what this phase needs, test it, continue.

Examples:

| Phase | Possible integration |
|---|---|
| Lead Capture | Facebook / IndiaMART |
| Conversations | WhatsApp / Gmail / Instagram |
| Calendar | Google Calendar / Microsoft Calendar |
| Workflows | Webhooks / API integrations |
| Customer 360 | ERP integrations |
| Reporting | integration attribution data |

---

## 7. Mapping to this codebase (Claude's notes, 2026-10-01)

Existing infrastructure an integration layer should reuse — verified in the repo, not assumed:

| Need | Existing piece |
|---|---|
| Encrypting stored tokens/API keys | `src/core/security/encryption.ts` (`encryptSecret` / `decryptSecret`, key derived from `AUTH_SECRET`) |
| OAuth `state` signing (CSRF-safe callbacks) | `src/core/security/oauth-state.ts` |
| Provider/adapter + DB-stored encrypted credentials precedent | AI Provider Management (`src/core/ai/provider-manager`, `AI_PROVIDER_MANAGEMENT.md`) |
| Outbound messaging interface | `src/core/communication/CommunicationProvider.ts` (currently a manual no-op provider) + `src/lib/communication.ts` (tel / mailto / wa.me links) |
| Retries, delayed jobs, async sync | BullMQ + Redis (`src/core/jobs/queue.ts`, `worker.ts`) — today only the bulk-import queue |
| In-app notifications | `src/core/notifications/NotificationService.ts` (`NotificationChannel` enum already has EMAIL / SMS) |
| Files / documents | `AttachmentService` + `FileStorage` (local disk, `FILE_STORAGE_ROOT`) |
| Audit trail | `writeAuditLog` (`AuditLog` table) |
| ERP entities to link (not copy) | Customer, Buyer, BuyerEnquiry, SampleRequest, SalesOrder, SalesInvoice, Payment, Product, Employee, User |
| Not present in ERP | Quotations, Projects, Support tickets, Calendar, Tasks |

Notes:
- **Public endpoints** (incoming webhooks, public forms, OAuth callbacks) need routes that bypass session auth in `src/proxy.ts` and must be secured by signatures/tokens instead.
- The removed Meta/Google Ads integration (`src/modules/marketing/ad-integrations/`, still in git history on `main`) is a reference for an OAuth connect → callback → encrypted token → sync pattern.
- Env-var credentials (`META_APP_ID`, `GOOGLE_ADS_*`, etc.) are app-level; per-company connections belong in the DB, encrypted.
